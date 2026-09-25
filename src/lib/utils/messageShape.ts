import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

/**
 * a finished turn with each round reasoning and preamble on its first Call update, content only
 * the final answer and reasoning its own, without it content holds every round think block and
 * preamble before the answer and stream markers place tool cards by offset into it
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

/** for readers and payloads that predate the rounds shape */
export function toLegacyShape<T extends ShapedMessage>(message: T): T {
	if (message.contentShape !== ROUNDS_SHAPE) return message;
	const legacy = { ...message, content: rebuildLegacyContent(message).content };
	delete legacy.contentShape;
	delete legacy.reasoning;
	return legacy;
}
