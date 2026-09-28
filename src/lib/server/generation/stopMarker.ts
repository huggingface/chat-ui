import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";

/**
 * The cross-pod Stop channel, for a run with no request behind it. A Stop lands on whichever
 * pod serves it: the in-process AbortRegistry reaches only that pod's controllers, and the
 * generation loop consults its cached marker only between model outputs — useless while a
 * run waits on its first token or a long tool call. Same protocol as the conversation
 * route, which owns the reasoning (see STOP_MARKER_GRACE_MS there): clear what is stale
 * before anyone can know this run exists, then any marker seen is meant for it.
 */
const STOP_MARKER_GRACE_MS = 5_000;
const WATCH_INTERVAL_MS = 300;

/** Call before the run is announced (turn state, generationId stamp), never after. */
export async function clearStaleStopMarker(conversationId: ObjectId): Promise<void> {
	await collections.abortedGenerations
		.deleteOne({
			conversationId,
			updatedAt: { $lt: new Date(Date.now() - STOP_MARKER_GRACE_MS) },
		})
		.catch((err) => logger.warn({ err }, "[stop] failed to clear a stale stop marker"));
}

/** Aborts `controller` once a stop marker appears. Returns the function that ends the watch. */
export function watchStopMarker(conversationId: ObjectId, controller: AbortController): () => void {
	const watcher = setInterval(() => {
		collections.abortedGenerations
			.findOne({ conversationId })
			.then((marker) => {
				if (marker && !controller.signal.aborted) {
					logger.info(
						{ conversationId: conversationId.toString() },
						"Stop marker observed; aborting generation"
					);
					controller.abort();
				}
				if (marker || controller.signal.aborted) clearInterval(watcher);
			})
			.catch(() => {
				// transient DB error; the next tick retries
			});
	}, WATCH_INTERVAL_MS);
	watcher.unref?.();
	return () => clearInterval(watcher);
}
