import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageElicitationResolvedUpdate,
	type MessageHarnessEventUpdate,
	type MessagePlanUpdate,
	type MessageToolUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";
import {
	isMessageElicitationRequestUpdate,
	isMessageElicitationResolvedUpdate,
	isMessageHarnessEventUpdate,
	isMessageNoticeUpdate,
	isMessagePlanUpdate,
	isMessageToolUpdate,
} from "./messageUpdates";
import { splitArtifactSegments, type ArtifactOperation } from "./artifacts";
import { ROUNDS_SHAPE, toolRounds } from "./messageShape";

// Zero-config reasoning autodetection: detect <think> blocks in content
export const THINK_BLOCK_REGEX = /(<think>[\s\S]*?(?:<\/think>|$))/gi;

export type ElicitationBlock = {
	type: "elicitation";
	request: ElicitationRequestPayload;
	expiresAt?: number;
	resolved?: MessageElicitationResolvedUpdate;
};

/**
 * `round` on text, think and tool blocks is the tool round they belong to, counted like
 * toolRounds(): reasoning and preamble go with the round whose calls follow them, and what comes
 * after the last round's results with the round after it. Activity labels are keyed by it.
 */
export type MessageBlock =
	| { type: "text"; content: string; round?: number }
	| { type: "think"; content: string; closed: boolean; round?: number }
	| { type: "tool"; uuid: string; updates: MessageToolUpdate[]; round?: number }
	| { type: "artifact"; op: ArtifactOperation; opIndex: number }
	| ElicitationBlock
	| { type: "plan"; update: MessagePlanUpdate }
	| { type: "harnessEvent"; update: MessageHarnessEventUpdate }
	| { type: "notice"; text: string };

type ToolBlock = Extract<MessageBlock, { type: "tool" }>;

// Expand any text block containing <think>…</think> into dedicated think blocks
// so reasoning can be grouped/collapsed separately from the answer text.
function expandThinkBlocks(input: MessageBlock[]): MessageBlock[] {
	const out: MessageBlock[] = [];
	for (const block of input) {
		if (block.type !== "text") {
			out.push(block);
			continue;
		}
		for (const part of block.content.split(THINK_BLOCK_REGEX)) {
			if (!part) continue;
			if (part.startsWith("<think>")) {
				const closed = part.endsWith("</think>");
				out.push({
					type: "think",
					content: part.slice(7, closed ? -8 : undefined),
					closed,
					round: block.round,
				});
			} else if (part.trim().length > 0) {
				out.push({ type: "text", content: part, round: block.round });
			}
		}
	}
	return out;
}

// Replace inline <artifact> blocks in text with dedicated artifact blocks that
// render as cards (content lives in the artifact panel). Streaming-safe:
// partially received tags are hidden until complete.
function expandArtifactBlocks(input: MessageBlock[]): MessageBlock[] {
	const out: MessageBlock[] = [];
	let opIndex = 0;
	for (const block of input) {
		if (block.type !== "text") {
			out.push(block);
			continue;
		}
		for (const segment of splitArtifactSegments(block.content)) {
			if (segment.type === "artifact") {
				out.push({ type: "artifact", op: segment.op, opIndex: opIndex++ });
			} else if (segment.content.length > 0) {
				out.push({ type: "text", content: segment.content });
			}
		}
	}
	return collapseConsecutiveArtifactOps(out);
}

// Models sometimes emit several back-to-back operations on the same artifact
// (e.g. one update block per find/replace pair). Every op still becomes a
// version in the registry, but showing a card per op clutters the chat —
// keep only the last card of each consecutive run.
function collapseConsecutiveArtifactOps(input: MessageBlock[]): MessageBlock[] {
	const out: MessageBlock[] = [];
	for (const block of input) {
		if (block.type === "artifact") {
			let i = out.length - 1;
			while (i >= 0) {
				const prior = out[i];
				if (prior.type === "text" && prior.content.trim().length === 0) {
					i -= 1;
					continue;
				}
				if (prior.type === "artifact" && prior.op.identifier === block.op.identifier) {
					// Drop the earlier card (and the whitespace between) — this
					// later op supersedes it.
					out.splice(i, out.length - i);
				}
				break;
			}
		}
		out.push(block);
	}
	return out;
}

/** the updates that render the same in both shapes */
function applyCardUpdate(res: MessageBlock[], update: MessageUpdate, round?: number): void {
	if (isMessageToolUpdate(update)) {
		const existingBlock = res.find(
			(b): b is ToolBlock => b.type === "tool" && b.uuid === update.uuid
		);
		if (existingBlock) {
			existingBlock.updates.push(update);
		} else {
			res.push({ type: "tool" as const, uuid: update.uuid, updates: [update], round });
		}
	} else if (isMessageElicitationRequestUpdate(update)) {
		res.push({
			type: "elicitation" as const,
			request: update.request,
			expiresAt: update.expiresAt,
		});
	} else if (isMessageElicitationResolvedUpdate(update)) {
		// Settles the existing block rather than adding one.
		const target = res.find(
			(b): b is ElicitationBlock =>
				b.type === "elicitation" && b.request.elicitationId === update.elicitationId
		);
		if (target) target.resolved = update;
	} else if (isMessagePlanUpdate(update)) {
		// One live card per message: a later update supersedes the earlier card and
		// takes its stream position, and the generic tool card for the same call
		// gives way to the dedicated one (a failed call emits no Plan update, so
		// its error card survives).
		const toolIdx = res.findIndex((b) => b.type === "tool" && b.uuid === update.uuid);
		if (toolIdx !== -1) res.splice(toolIdx, 1);
		const planIdx = res.findIndex((b) => b.type === "plan");
		if (planIdx !== -1) res.splice(planIdx, 1);
		res.push({ type: "plan", update });
	} else if (isMessageHarnessEventUpdate(update)) {
		res.push({ type: "harnessEvent", update });
	} else if (isMessageNoticeUpdate(update)) {
		res.push({ type: "notice", text: update.text });
	}
}

function pushRoundText(
	res: MessageBlock[],
	reasoning: string | undefined,
	visible: string,
	round: number
) {
	if (reasoning !== undefined) res.push({ type: "think", content: reasoning, closed: true, round });
	if (visible.trim().length > 0) res.push({ type: "text", content: visible, round });
}

/** round text goes right before the first call of the round, where its stream markers were */
function roundsShapeBlocks(message: Pick<Message, "content" | "reasoning" | "updates">) {
	const updates = message.updates ?? [];
	const rounds = toolRounds(updates);
	const firstCalls = new Map(
		rounds.map((round, index) => [round.start, { call: round.calls[0], index }])
	);
	const callRound = new Map(
		rounds.flatMap((round, index) => round.calls.map((call) => [call.uuid, index] as const))
	);
	const res: MessageBlock[] = [];
	for (const [index, update] of updates.entries()) {
		const first = firstCalls.get(index);
		if (first) pushRoundText(res, first.call.reasoning, first.call.content ?? "", first.index);
		applyCardUpdate(
			res,
			update,
			isMessageToolUpdate(update) ? callRound.get(update.uuid) : undefined
		);
	}
	pushRoundText(res, message.reasoning, message.content, rounds.length);
	return expandArtifactBlocks(res);
}

export function messageBlocks(
	message: Pick<Message, "content" | "reasoning" | "updates" | "contentShape">
): MessageBlock[] {
	if (message.contentShape === ROUNDS_SHAPE) return roundsShapeBlocks(message);

	const updates = message.updates ?? [];
	const res: MessageBlock[] = [];
	const hasTools = updates.some(isMessageToolUpdate);
	let contentCursor = 0;
	let sawFinalAnswer = false;
	// tool rounds as toolRounds() counts them: a Call after any Result or Error starts the next
	let round = -1;
	let roundHasOutcome = false;
	const textRound = () => (round === -1 || roundHasOutcome ? round + 1 : round);

	// Fast path: no tool updates at all
	if (!hasTools && updates.length === 0) {
		return expandArtifactBlocks(
			expandThinkBlocks(
				message.content ? [{ type: "text" as const, content: message.content }] : []
			)
		);
	}

	for (const update of updates) {
		if (update.type === MessageUpdateType.Stream) {
			const token =
				typeof update.token === "string" && update.token.length > 0 ? update.token : null;
			const len = token !== null ? token.length : (update.len ?? 0);
			const chunk =
				token ?? (message.content ? message.content.slice(contentCursor, contentCursor + len) : "");
			contentCursor += len;
			if (!chunk) continue;
			const last = res.at(-1);
			if (last?.type === "text") last.content += chunk;
			else res.push({ type: "text" as const, content: chunk, round: textRound() });
		} else if (update.type === MessageUpdateType.FinalAnswer) {
			sawFinalAnswer = true;
			const finalText = update.text ?? "";
			const currentText = res
				.filter((b) => b.type === "text")
				.map((b) => (b as { type: "text"; content: string }).content)
				.join("");

			let addedText = "";
			if (finalText.startsWith(currentText)) {
				addedText = finalText.slice(currentText.length);
			} else if (!currentText.endsWith(finalText)) {
				const needsGap = !/\n\n$/.test(currentText) && !/^\n/.test(finalText);
				addedText = (needsGap ? "\n\n" : "") + finalText;
			}

			if (addedText) {
				const last = res.at(-1);
				if (last?.type === "text") {
					last.content += addedText;
				} else {
					res.push({ type: "text" as const, content: addedText, round: textRound() });
				}
			}
		} else {
			if (isMessageToolUpdate(update)) {
				if (update.subtype === MessageToolUpdateType.Call) {
					if (round === -1 || roundHasOutcome) {
						round += 1;
						roundHasOutcome = false;
					}
				} else if (
					update.subtype === MessageToolUpdateType.Result ||
					update.subtype === MessageToolUpdateType.Error
				) {
					roundHasOutcome = true;
				}
			}
			applyCardUpdate(res, update, isMessageToolUpdate(update) ? round : undefined);
		}
	}

	// If content remains unmatched (e.g., persisted stream markers), append the remainder
	// Skip when a FinalAnswer already provided the authoritative text.
	if (!sawFinalAnswer && message.content && contentCursor < message.content.length) {
		const remaining = message.content.slice(contentCursor);
		if (remaining.length > 0) {
			const last = res.at(-1);
			if (last?.type === "text") last.content += remaining;
			else res.push({ type: "text" as const, content: remaining, round: textRound() });
		}
	} else if (!res.some((b) => b.type === "text") && message.content) {
		// Fallback: no text produced at all
		res.push({ type: "text" as const, content: message.content });
	}

	return expandArtifactBlocks(expandThinkBlocks(res));
}
