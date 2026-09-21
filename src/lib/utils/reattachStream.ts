import type { MessageUpdate } from "$lib/types/MessageUpdate";

/** In-band marker for the server's `caughtUp` frame: everything before it was replay. */
export const CAUGHT_UP = Symbol("caughtUp");
export type ReattachFrame = MessageUpdate | typeof CAUGHT_UP;

/**
 * Adapt the reattach SSE endpoint to an async iterator for {@link consumeReattachStream}.
 * EventSource auto-reconnects and resends the last event id, so this only surfaces
 * `update` frames and the `caughtUp` marker, and stops on `end` or abort.
 */
export async function* reattachStream(
	url: string,
	signal: AbortSignal
): AsyncGenerator<ReattachFrame> {
	const source = new EventSource(url);
	const queue: ReattachFrame[] = [];
	let done = false;
	let wake: (() => void) | null = null;
	const notify = () => {
		wake?.();
		wake = null;
	};

	source.addEventListener("update", (event) => {
		try {
			queue.push(JSON.parse((event as MessageEvent).data) as MessageUpdate);
		} catch {
			// ignore a malformed frame rather than tear down the stream
		}
		notify();
	});
	source.addEventListener("caughtUp", () => {
		queue.push(CAUGHT_UP);
		notify();
	});

	// Close ourselves so EventSource does not auto-reconnect after a deliberate end.
	const finish = () => {
		done = true;
		source.close();
		notify();
	};
	source.addEventListener("end", finish);
	signal.addEventListener("abort", finish, { once: true });

	try {
		for (;;) {
			const next = queue.shift();
			if (next !== undefined) {
				yield next;
				continue;
			}
			if (done) return;
			await new Promise<void>((resolve) => (wake = resolve));
		}
	} finally {
		source.close();
	}
}
