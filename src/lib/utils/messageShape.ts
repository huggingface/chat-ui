import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageStreamUpdate,
	type MessageToolCallUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { ToolCall } from "$lib/types/Tool";

/**
 * a finished turn with each round reasoning and preamble on its first Call update, content only
 * the final answer and reasoning its own, without it content holds every round think block and
 * preamble before the answer and stream markers place tool cards by offset into it, stored
 * without stream markers, the final answer text as a length and call parameters empty where
 * argumentsRaw holds them
 */
export const ROUNDS_SHAPE = 2;

type ShapedMessage = Pick<Message, "content" | "reasoning" | "updates" | "contentShape">;

export interface ToolRound {
	/** index of the first Call update, the one that carries the round text */
	start: number;
	calls: MessageToolCallUpdate[];
}

/** a Call after any Result or Error starts a new round, as the live loop emits them */
export function toolRounds(updates: MessageUpdate[]): ToolRound[] {
	const rounds: ToolRound[] = [];
	let round: ToolRound | undefined;
	let roundHasOutcome = false;
	for (const [index, update] of updates.entries()) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Call) {
			if (!round || roundHasOutcome) {
				round = { start: index, calls: [] };
				rounds.push(round);
				roundHasOutcome = false;
			}
			round.calls.push(update);
		} else if (
			update.subtype === MessageToolUpdateType.Result ||
			update.subtype === MessageToolUpdateType.Error
		) {
			roundHasOutcome = true;
		}
	}
	return rounds;
}

/** one round as the live loop streams it into content */
export function roundText(reasoning: string | undefined, visible: string | undefined): string {
	return (reasoning ? `<think>${reasoning}</think>` : "") + (visible ?? "");
}

/** the original shape, for any reader that needs the whole visible text or parses think blocks */
export function rebuildLegacyContent(message: ShapedMessage): {
	content: string;
	reasoning?: string;
} {
	if (message.contentShape !== ROUNDS_SHAPE) {
		return { content: message.content, reasoning: message.reasoning };
	}
	let content = "";
	for (const { calls } of toolRounds(message.updates ?? [])) {
		content += roundText(calls[0].reasoning, calls[0].content);
	}
	return { content: content + roundText(message.reasoning, message.content) };
}

export function argumentsObject(raw: string | undefined): Record<string, unknown> | undefined {
	if (!raw) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** what a Call update keeps as parameters, the primitive top level of the arguments */
export function primitiveArguments(args: Record<string, unknown>): ToolCall["parameters"] {
	const parameters: ToolCall["parameters"] = {};
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			parameters[key] = value;
		}
	}
	return parameters;
}

/** the rounds shape stores parameters empty when argumentsRaw holds them, nested values included */
export function callArguments(update: MessageToolCallUpdate): Record<string, unknown> {
	return argumentsObject(update.argumentsRaw) ?? update.call.parameters;
}

const streamMarker = (len: number): MessageStreamUpdate => ({
	type: MessageUpdateType.Stream,
	token: "",
	len,
});

/**
 * one marker per round before its first call and one for the answer before its FinalAnswer, for
 * readers that cut content by markers
 */
function legacyUpdates(message: ShapedMessage, content: string): MessageUpdate[] {
	const updates = message.updates ?? [];
	if (updates.some((update) => update.type === MessageUpdateType.Stream)) return updates;
	const rounds = toolRounds(updates);
	const firstCalls = new Map(rounds.map((round) => [round.start, round.calls[0]]));
	const lastRound = rounds.at(-1)?.start ?? -1;
	const lastAnswer = updates.findLastIndex(
		(update, index) => index > lastRound && update.type === MessageUpdateType.FinalAnswer
	);
	const finalAt = lastAnswer === -1 ? updates.length : lastAnswer;
	const finalLength = roundText(message.reasoning, message.content).length;
	const legacy: MessageUpdate[] = [];
	for (const [index, update] of updates.entries()) {
		const first = firstCalls.get(index);
		const length = first
			? roundText(first.reasoning, first.content).length
			: index === finalAt
				? finalLength
				: 0;
		if (length > 0) legacy.push(streamMarker(length));
		if (
			index === finalAt &&
			update.type === MessageUpdateType.FinalAnswer &&
			!update.text &&
			update.len
		) {
			const { len, ...answer } = update;
			// the route merges every answer into the end of content
			legacy.push({ ...answer, text: content.slice(Math.max(0, content.length - len)) });
		} else if (
			update.type === MessageUpdateType.Tool &&
			update.subtype === MessageToolUpdateType.Call &&
			Object.keys(update.call.parameters).length === 0
		) {
			const args = argumentsObject(update.argumentsRaw);
			legacy.push(
				args
					? { ...update, call: { ...update.call, parameters: primitiveArguments(args) } }
					: update
			);
		} else {
			legacy.push(update);
		}
	}
	if (finalAt === updates.length && finalLength > 0) legacy.push(streamMarker(finalLength));
	return legacy;
}

/** for readers and payloads that predate the rounds shape */
export function toLegacyShape<T extends ShapedMessage>(message: T): T {
	if (message.contentShape !== ROUNDS_SHAPE) return message;
	const content = rebuildLegacyContent(message).content;
	const legacy = { ...message, content, updates: legacyUpdates(message, content) };
	delete legacy.contentShape;
	delete legacy.reasoning;
	return legacy;
}

/**
 * guards a turn misjudged as ended, whose round text would otherwise come back twice, and whose
 * stream markers the live renderer and the next conversion both cut content by
 */
export function restoreRunningShape(message: Message): void {
	if (message.contentShape !== ROUNDS_SHAPE) return;
	const legacy = toLegacyShape(message);
	message.content = legacy.content;
	message.updates = legacy.updates;
	delete message.reasoning;
	delete message.contentShape;
}
