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
	const kept = (updates ?? [])
		.filter(
			(u) =>
				!(u.type === MessageUpdateType.Status && u.status === MessageUpdateStatus.KeepAlive) &&
				!(u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Progress)
		)
		.map((u) => {
			if (u.type !== MessageUpdateType.Stream) return u;
			const len = u.len ?? (u.token ?? "").length;
			return { type: MessageUpdateType.Stream, token: "", len } satisfies MessageStreamUpdate;
		});

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
