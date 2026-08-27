import { logger } from "$lib/server/logger";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageStreamUpdate,
} from "$lib/types/MessageUpdate";
import type { Message } from "$lib/types/Message";

/**
 * A conversation is one MongoDB document, and Mongo caps a document at 16MB.
 * Past that ceiling every write to it fails — not slowly, permanently: the
 * conversation can never be added to again.
 *
 * That ceiling is reachable. One ML Assistant run polling a training job
 * produced a single assistant message carrying 73,994 updates and 15.1MB, of
 * which 59,487 were MCP progress notifications. Progress is live-only UI: once
 * the result is stored, a progress tick tells a reader nothing the result does
 * not, and it is replayed to the browser on every load forever.
 *
 * So progress is dropped here rather than merely rendered cheaply. The cap below
 * is the backstop for whatever the next unbounded emitter turns out to be.
 */
const MAX_PERSISTED_UPDATES = 5_000;

/**
 * Shape a message's updates for storage: drop keepalives and live-only progress,
 * and replace each stream token with a length marker (content is stored
 * separately), preserving ordering without duplicating text. Shared by the full
 * save and the writer's incremental materialise so both persist the same thing
 * under materializedSeq.
 *
 * Only what is *persisted* changes. Everything still streams to the connected
 * client as it always did.
 */
export function compressUpdatesForStorage(updates: Message["updates"]): Message["updates"] {
	const kept: NonNullable<Message["updates"]> = [];
	for (const u of updates ?? []) {
		if (u.type === MessageUpdateType.Status && u.status === MessageUpdateStatus.KeepAlive) {
			continue;
		}
		if (u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Progress) {
			continue;
		}
		if (u.type !== MessageUpdateType.Stream) {
			kept.push(u);
			continue;
		}
		// Stream markers exist ONLY to position tool cards relative to the text
		// (the renderer slices message.content by their lens), so consecutive
		// markers carry no more information than their sum. Merging them is what
		// keeps a long turn's marker count proportional to its tool cards rather
		// than its tokens — an unmerged 30-minute reasoning turn crossed the cap
		// below, the backstop dropped every marker, and the whole message
		// rendered as one unanchored blob with no tool calls in sight.
		const len = u.len ?? (u.token ?? "").length;
		if (len === 0) continue;
		const last = kept.at(-1);
		if (last?.type === MessageUpdateType.Stream) {
			last.len = (last.len ?? 0) + len;
		} else {
			kept.push({ type: MessageUpdateType.Stream, token: "", len } satisfies MessageStreamUpdate);
		}
	}

	if (kept.length <= MAX_PERSISTED_UPDATES) return kept;

	// Over the cap, stream markers go first: they carry no text — that lives on
	// the message — and only preserve where tool cards sit relative to it. The
	// tool calls and their results ARE the transcript, so they are the last thing
	// to go, and even then the most recent survive.
	const withoutStreamMarkers = kept.filter((u) => u.type !== MessageUpdateType.Stream);
	const capped =
		withoutStreamMarkers.length <= MAX_PERSISTED_UPDATES
			? withoutStreamMarkers
			: withoutStreamMarkers.slice(-MAX_PERSISTED_UPDATES);

	logger.warn(
		{ before: updates?.length ?? 0, after: capped.length, cap: MAX_PERSISTED_UPDATES },
		"[generation] message updates exceeded the persistence cap and were truncated"
	);
	return capped;
}
