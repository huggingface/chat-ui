import type { Message } from "$lib/types/Message";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { consumeMessageUpdates, type ConsumeContext } from "./consumeMessageUpdates";
import { applyStreamingMode } from "./messageUpdates";
import { CAUGHT_UP, type ReattachFrame } from "./reattachStream";

/**
 * How long replayed updates are held waiting for the `caughtUp` marker. A server that
 * predates the marker never sends it; past this the held updates take the configured
 * streaming mode, exactly as every update did before the marker existed. Keep it above
 * the stream endpoint's CAUGHT_UP_GAP_WAIT_MS, which may delay the marker that long.
 */
export const CAUGHT_UP_WAIT_MS = 2000;

async function* fromArray(updates: MessageUpdate[]): AsyncGenerator<MessageUpdate> {
	yield* updates;
}

/**
 * Apply a reattach stream to `message` in two phases: the replayed backlog (everything
 * before `caughtUp`) in one unpaced pass, then live updates in the configured streaming
 * mode. Without a marker — an older server, a backlog slower than the wait, a stream
 * that ends first — every update goes through the configured mode instead.
 */
export async function consumeReattachStream(
	frames: AsyncGenerator<ReattachFrame>,
	message: Message,
	ctx: ConsumeContext,
	{ caughtUpWaitMs = CAUGHT_UP_WAIT_MS }: { caughtUpWaitMs?: number } = {}
): Promise<void> {
	let held: MessageUpdate[] = [];
	let pending: Promise<IteratorResult<ReattachFrame>> | undefined;
	let caughtUp = false;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<"timedOut">((resolve) => {
		timer = setTimeout(() => resolve("timedOut"), caughtUpWaitMs);
	});
	try {
		while (!caughtUp) {
			pending ??= frames.next();
			let result: IteratorResult<ReattachFrame> | "timedOut";
			try {
				result = await Promise.race([pending, timedOut]);
			} catch {
				// Leave the rejection in `pending`: the live phase rethrows it after the
				// held updates, which is where a source error surfaced before the marker.
				break;
			}
			// On a timeout `pending` stays set, so the frame it resolves to is not lost.
			if (result === "timedOut") break;
			if (result.done) break;
			pending = undefined;
			if (result.value === CAUGHT_UP) caughtUp = true;
			else held.push(result.value);
		}
	} finally {
		clearTimeout(timer);
	}

	if (caughtUp && held.length > 0) {
		// An unbounded debounce keeps the backlog's text in one content write, so the
		// first resize-driven scroll snap already sees the final height.
		await consumeMessageUpdates(fromArray(held), message, {
			...ctx,
			streamingMode: "raw",
			maxUpdateTime: Number.POSITIVE_INFINITY,
		});
		held = [];
	}

	async function* live(): AsyncGenerator<MessageUpdate> {
		try {
			yield* held;
			for (;;) {
				const result = await (pending ?? frames.next());
				pending = undefined;
				if (result.done) return;
				// Each reconnect replays and sends its own marker; only the first splits.
				if (result.value !== CAUGHT_UP) yield result.value;
			}
		} finally {
			void frames.return(undefined);
		}
	}

	await consumeMessageUpdates(applyStreamingMode(live(), ctx.streamingMode), message, ctx);
}
