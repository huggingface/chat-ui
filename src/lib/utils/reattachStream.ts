import type { MessageUpdate } from "$lib/types/MessageUpdate";

/** In-band marker for the server's `caughtUp` frame: everything before it was replay. */
export const CAUGHT_UP = Symbol("caughtUp");
export type ReattachFrame = MessageUpdate | typeof CAUGHT_UP;

// The server tails every 250 ms and sends a heartbeat on every idle tick, so this
// much silence means the connection is dead, not quiet.
const STALL_MS = 10_000;
const MIN_RESUBSCRIBE_INTERVAL_MS = 1_000;

/**
 * The server answered a reconnect with a non-200, which ends EventSource's
 * native retries for good. `opened` tells a caller backing off whether this
 * subscription ever worked.
 */
export class ReattachClosedError extends Error {
	constructor(readonly opened: boolean) {
		super("Reattach stream closed by the server");
		this.name = "ReattachClosedError";
	}
}

export interface ReattachStream {
	updates: AsyncGenerator<ReattachFrame>;
	/** Drop the connection and resume after the last delivered sequence. */
	resubscribe: () => void;
}

/**
 * Adapt the reattach SSE endpoint to an async iterator for
 * {@link consumeReattachStream}. Surfaces only `update` frames and the
 * `caughtUp` marker; stops on `end` or abort, and throws
 * {@link ReattachClosedError} once the queue is drained if the browser gives up
 * on the connection.
 *
 * Every reconnect happens UNDER the queue, from the last sequence this
 * subscription delivered, so the consumer sees one gapless stream. That is the
 * only cursor that can be trusted mid-turn: the message's `materializedSeq` is
 * as old as the snapshot it was loaded with.
 *
 * The server marks the end of EVERY connection's replay, so a re-subscribed
 * connection yields `CAUGHT_UP` again; the consumer acts on the first only.
 */
export function reattachStream(
	url: string,
	signal: AbortSignal,
	{ stallMs = STALL_MS }: { stallMs?: number } = {}
): ReattachStream {
	const queue: ReattachFrame[] = [];
	let source: EventSource | null = null;
	let started = false;
	let done = false;
	let opened = false;
	let failure: ReattachClosedError | null = null;
	let lastFrameAt = 0;
	let connectedAt = 0;
	let watchdog: ReturnType<typeof setTimeout> | undefined;
	let wake: (() => void) | null = null;

	const target = new URL(url, globalThis.location?.href);
	const initialSeq = Number.parseInt(target.searchParams.get("fromSeq") ?? "0", 10);
	let lastSeq = Number.isFinite(initialSeq) && initialSeq >= 0 ? initialSeq : 0;

	const notify = () => {
		wake?.();
		wake = null;
	};

	// Close ourselves so EventSource does not auto-reconnect after a deliberate end.
	const finish = () => {
		done = true;
		clearTimeout(watchdog);
		source?.close();
		notify();
	};

	const connect = () => {
		source?.close();
		target.searchParams.set("fromSeq", String(lastSeq));
		const es = new EventSource(target);
		source = es;
		connectedAt = lastFrameAt = Date.now();

		// A closed source can still have frames queued for dispatch.
		const live = () => es === source && !done;

		es.addEventListener("open", () => {
			if (!live()) return;
			opened = true;
			lastFrameAt = Date.now();
		});

		es.addEventListener("update", (event) => {
			if (!live()) return;
			lastFrameAt = Date.now();
			const { data, lastEventId } = event as MessageEvent<string>;
			const seq = Number.parseInt(lastEventId, 10);
			if (Number.isFinite(seq)) {
				if (seq <= lastSeq) return;
				lastSeq = seq;
			}
			try {
				queue.push(JSON.parse(data) as MessageUpdate);
			} catch {
				// ignore a malformed frame rather than tear down the stream
			}
			notify();
		});

		es.addEventListener("caughtUp", () => {
			if (!live()) return;
			lastFrameAt = Date.now();
			queue.push(CAUGHT_UP);
			notify();
		});

		es.addEventListener("heartbeat", () => {
			if (live()) lastFrameAt = Date.now();
		});

		es.addEventListener("end", () => {
			if (live()) finish();
		});

		es.addEventListener("error", () => {
			// CONNECTING means the browser is retrying by itself; only CLOSED is final.
			if (!live() || es.readyState !== EventSource.CLOSED) return;
			failure = new ReattachClosedError(opened);
			finish();
		});
	};

	const armWatchdog = () => {
		clearTimeout(watchdog);
		if (done) return;
		watchdog = setTimeout(
			() => {
				if (done) return;
				if (Date.now() - lastFrameAt >= stallMs) connect();
				armWatchdog();
			},
			Math.max(0, lastFrameAt + stallMs - Date.now())
		);
	};

	async function* iterate(): AsyncGenerator<ReattachFrame> {
		if (signal.aborted) return;
		started = true;
		signal.addEventListener("abort", finish, { once: true });
		connect();
		armWatchdog();

		try {
			for (;;) {
				const next = queue.shift();
				if (next !== undefined) {
					yield next;
					continue;
				}
				if (done) {
					if (failure && !signal.aborted) throw failure;
					return;
				}
				await new Promise<void>((resolve) => (wake = resolve));
			}
		} finally {
			signal.removeEventListener("abort", finish);
			finish();
		}
	}

	return {
		updates: iterate(),
		resubscribe: () => {
			if (!started || done) return;
			// A wake-up fires the watchdog and the page's triggers together.
			if (Date.now() - connectedAt < MIN_RESUBSCRIBE_INTERVAL_MS) return;
			connect();
			armWatchdog();
		},
	};
}
