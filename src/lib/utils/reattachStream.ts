import type { MessageUpdate } from "$lib/types/MessageUpdate";

/**
 * Adapt the reattach SSE endpoint to an async iterator of MessageUpdates for
 * {@link consumeMessageUpdates}. EventSource auto-reconnects and resends the last
 * event id, so this only surfaces `update` frames and stops on `end` or abort.
 */
export async function* reattachStream(
	url: string,
	signal: AbortSignal
): AsyncGenerator<MessageUpdate> {
	const source = new EventSource(url);
	const queue: MessageUpdate[] = [];
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
