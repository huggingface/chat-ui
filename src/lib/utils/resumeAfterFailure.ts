import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import { turnStateOf } from "$lib/utils/generationState";

/**
 * Recovery for failed agentic turns that is not "throw the work away". Retry
 * re-runs the whole turn: it duplicates side effects (jobs submitted twice,
 * repos re-created) and discards hours of tool transcript. Resume instead
 * sends a new user message telling the model its turn died and to continue
 * from what history already shows — the failed turn's tool runs replay to the
 * model (prepareFiles synthesizes results for calls interrupted mid-flight),
 * so "pick up where you left off" is grounded, not hopeful.
 */

/** Keeps a huge upstream error (e.g. an echoed request payload) from becoming
 * the bulk of the resume message. */
const MAX_FAILURE_DETAIL_CHARS = 500;

function failedStatusOf(message: Message) {
	const updates = message.updates ?? [];
	for (let i = updates.length - 1; i >= 0; i -= 1) {
		const update = updates[i];
		if (update.type === MessageUpdateType.Status && update.status === MessageUpdateStatus.Error) {
			return update;
		}
	}
	return undefined;
}

/**
 * Whether a turn is worth resuming rather than retrying: it must have failed,
 * and it must have actually done something (at least one persisted tool call).
 * A turn that died before any work has nothing to preserve — retry is strictly
 * better there.
 */
export function canResumeAfterFailure(message?: Message): boolean {
	if (!message || message.from !== "assistant") return false;
	const failed = turnStateOf(message)?.state === "failed" || failedStatusOf(message) !== undefined;
	if (!failed) return false;
	return (message.updates ?? []).some(
		(update) =>
			update.type === MessageUpdateType.Tool && update.subtype === MessageToolUpdateType.Call
	);
}

/**
 * The failure detail worth telling the model. The status error carries the
 * real upstream message ("rate limited" reads very differently from "invalid
 * payload"); the turn state's error is a generic fallback.
 */
export function failureDetailOf(message?: Message): string | undefined {
	if (!message || message.from !== "assistant") return undefined;
	const detail = failedStatusOf(message)?.message || turnStateOf(message)?.error;
	if (!detail) return undefined;
	return detail.length > MAX_FAILURE_DETAIL_CHARS
		? `${detail.slice(0, MAX_FAILURE_DETAIL_CHARS)}…`
		: detail;
}

export function buildResumeMessage(detail?: string): string {
	const what = detail
		? `Your previous turn failed partway through (error: ${detail}).`
		: `Your previous turn failed partway through.`;
	return `${what} Don't restart from scratch — review what already completed above, verify any in-flight side effects (submitted jobs, created repos, written files), and continue the task from where it left off.`;
}
