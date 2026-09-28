import { isDeepStrictEqual } from "node:util";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { isTurnEnded } from "$lib/utils/generationState";
import {
	ROUNDS_SHAPE,
	argumentsObject,
	primitiveArguments,
	rebuildLegacyContent,
	toolRounds,
	type ToolRound,
} from "$lib/utils/messageShape";

export type ShapeSkipReason =
	| "not_assistant"
	| "already_converted"
	| "not_finished"
	/** reasoning holds the non tool stream, so there is no room for the answer reasoning */
	| "legacy_reasoning"
	/** the stream markers before a round point outside content */
	| "stream_markers"
	/** a round slice of content is not its stored reasoning and preamble */
	| "round_text"
	/** what follows the last round is not one leading think block then plain text */
	| "final_text"
	/** nothing would move out of content */
	| "unchanged"
	| "rebuild_mismatch";

export type ShapeConversion = { message: Message } | { skipped: ShapeSkipReason };

/** a lone closing tag in the visible part is text a model wrote, every reader keeps it as text */
function splitRound(text: string): { reasoning?: string; visible: string } | undefined {
	let reasoning: string | undefined;
	let visible = text;
	if (text.startsWith("<think>")) {
		const close = text.indexOf("</think>");
		if (close === -1) return undefined;
		reasoning = text.slice("<think>".length, close);
		visible = text.slice(close + "</think>".length);
	}
	if (/<think>/i.test(visible)) return undefined;
	return { reasoning, visible };
}

/** where each round ends in content, the text streamed before its first call */
function roundEnds(updates: MessageUpdate[], rounds: ToolRound[]): number[] {
	const ends: number[] = [];
	let offset = 0;
	for (const [index, update] of updates.entries()) {
		if (ends.length < rounds.length && index === rounds[ends.length].start) ends.push(offset);
		if (update.type === MessageUpdateType.Stream) {
			offset += update.token ? update.token.length : (update.len ?? 0);
		}
	}
	return ends;
}

/**
 * rounds are cut at their stream markers so each keeps its exact streamed text, whitespace
 * included, and the result must rebuild byte for byte since the client still slices the rebuilt
 * content by stream marker offsets
 */
export function convertMessageShape(message: Message): ShapeConversion {
	if (message.from !== "assistant") return { skipped: "not_assistant" };
	if (message.contentShape === ROUNDS_SHAPE) return { skipped: "already_converted" };
	if (!isTurnEnded(message)) return { skipped: "not_finished" };
	if (message.reasoning) return { skipped: "legacy_reasoning" };

	const updates = message.updates ?? [];
	const rounds = toolRounds(updates);
	const ends = roundEnds(updates, rounds);
	const converted = [...updates];
	let start = 0;
	for (const [i, round] of rounds.entries()) {
		const end = ends[i];
		if (end < start || end > message.content.length) return { skipped: "stream_markers" };
		const [first, ...rest] = round.calls;
		const text = splitRound(message.content.slice(start, end));
		if (
			!text ||
			text.reasoning !== first.reasoning ||
			text.visible.trim() !== (first.content ?? "").trim() ||
			rest.some((call) => call.reasoning !== undefined || call.content !== undefined)
		) {
			return { skipped: "round_text" };
		}
		if (text.visible !== (first.content ?? "")) {
			converted[round.start] = { ...first, content: text.visible };
		}
		start = end;
	}
	const final = splitRound(message.content.slice(start));
	if (!final) return { skipped: "final_text" };
	if (final.visible === message.content) return { skipped: "unchanged" };

	const next: Message = {
		...message,
		content: final.visible,
		...(final.reasoning !== undefined ? { reasoning: final.reasoning } : {}),
		updates: converted,
		contentShape: ROUNDS_SHAPE,
	};
	const rebuilt = rebuildLegacyContent(next);
	if (
		rebuilt.content !== message.content ||
		(rebuilt.reasoning ?? "") !== (message.reasoning ?? "")
	) {
		return { skipped: "rebuild_mismatch" };
	}
	return { message: slimRoundsShape(next) };
}

/** parameters are the primitive top level of argumentsRaw, the tool card parses that instead */
function withoutParameters(update: MessageToolCallUpdate): MessageToolCallUpdate {
	if (Object.keys(update.call.parameters).length === 0) return update;
	const args = argumentsObject(update.argumentsRaw);
	if (!args || !isDeepStrictEqual(primitiveArguments(args), update.call.parameters)) return update;
	return { ...update, call: { ...update.call, parameters: {} } };
}

/** rounds place text so stream markers go, and a final answer repeats the end of content */
function slimRoundsShape(message: Message): Message {
	const updates: MessageUpdate[] = [];
	let changed = false;
	for (const update of message.updates ?? []) {
		let slim: MessageUpdate | undefined = update;
		if (update.type === MessageUpdateType.Stream) {
			slim = undefined;
		} else if (update.type === MessageUpdateType.FinalAnswer && update.text) {
			slim = { ...update, text: "", len: update.text.length };
		} else if (
			update.type === MessageUpdateType.Tool &&
			update.subtype === MessageToolUpdateType.Call
		) {
			slim = withoutParameters(update);
		}
		if (slim !== update) changed = true;
		if (slim) updates.push(slim);
	}
	return changed ? { ...message, updates } : message;
}

/** the rounds shape when the turn has ended and converts losslessly, else the message as it was */
export function convertFinishedMessage(message: Message): Message {
	const result = convertMessageShape(message);
	if ("message" in result) return result.message;
	// older builds stored the rounds shape with markers and answer text
	return message.contentShape === ROUNDS_SHAPE ? slimRoundsShape(message) : message;
}
