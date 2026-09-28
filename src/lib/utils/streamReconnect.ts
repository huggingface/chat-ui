import type { Message } from "$lib/types/Message";
import { isTurnSubscribable } from "./generationState";

/**
 * What a wake-up signal (tab visible again, bfcache restore, network back)
 * should do about the last assistant turn:
 *
 * - `resubscribe`: a subscription is held — replace its connection in place.
 * - `resync`: the turn should be subscribed but nothing is, or a resync is
 *   already backing off and should retry now — reload the snapshot, which
 *   re-subscribes from a cursor that matches it.
 * - `none`: the turn is terminal, or the POST that started it still owns it.
 */
export type ReconnectAction = "none" | "resubscribe" | "resync";

export function reconnectAction({
	lastAssistant,
	writeInFlight,
	subscribed,
	resyncing,
}: {
	lastAssistant: Message | undefined;
	writeInFlight: boolean;
	subscribed: boolean;
	resyncing: boolean;
}): ReconnectAction {
	if (writeInFlight) return "none";
	const subscribable = Boolean(lastAssistant?.generationId) && isTurnSubscribable(lastAssistant);
	if (subscribed) return subscribable ? "resubscribe" : "none";
	// Decided before the message is consulted: a turn whose POST stream dropped is still
	// the local placeholder, which has no generationId until the snapshot reloads.
	if (resyncing) return "resync";
	return subscribable ? "resync" : "none";
}

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** Delay before retry number `failures` (1-based); 0 for no failures yet. */
export function reconnectBackoffMs(failures: number): number {
	if (failures <= 0) return 0;
	return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
}

/**
 * `fetch()` rejects with a TypeError only when the transport failed (offline,
 * connection reset, DNS). An HTTP or validation failure is thrown by us as a
 * plain Error, and an abort is a DOMException — neither means the request may
 * have reached the server and left a turn running.
 */
export function isTransportFailure(err: unknown): boolean {
	return err instanceof TypeError;
}

const PROBE_TIMEOUT_MS = 10_000;

export interface ReachabilityWait {
	/** True once a probe succeeded; false if `signal` aborted first. */
	done: Promise<boolean>;
	/** Skip the current backoff, or give up on a probe that may be hanging, and try again now. */
	retryNow: () => void;
}

/**
 * Probe until the server answers, backing off between failures. Every probe is
 * abortable and time-bounded: this runs exactly when the network is unreliable,
 * and a request stuck on a half-open connection would otherwise never settle,
 * so the loop would never reach its backoff, a wake-up could not hurry it, and
 * nothing could cancel it.
 */
export function waitUntilReachable({
	probe,
	signal,
	initialDelayMs = 0,
	probeTimeoutMs = PROBE_TIMEOUT_MS,
}: {
	probe: (signal: AbortSignal) => Promise<boolean>;
	signal: AbortSignal;
	initialDelayMs?: number;
	probeTimeoutMs?: number;
}): ReachabilityWait {
	let interrupt: (() => void) | undefined;
	let hurried = false;

	const pause = (ms: number) =>
		new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", finish);
				interrupt = undefined;
				resolve();
			};
			const timer = setTimeout(finish, ms);
			signal.addEventListener("abort", finish, { once: true });
			interrupt = finish;
		});

	const attempt = async (): Promise<boolean> => {
		const controller = new AbortController();
		const cancel = () => controller.abort();
		const timer = setTimeout(cancel, probeTimeoutMs);
		signal.addEventListener("abort", cancel, { once: true });
		interrupt = cancel;
		// Raced, not just signalled: the loop must move on even if `probe` ignores its signal.
		const cancelled = new Promise<boolean>((resolve) =>
			controller.signal.addEventListener("abort", () => resolve(false), { once: true })
		);
		try {
			return await Promise.race([probe(controller.signal).catch(() => false), cancelled]);
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", cancel);
			interrupt = undefined;
		}
	};

	const run = async (): Promise<boolean> => {
		let delayMs = initialDelayMs;
		for (let failures = 1; !signal.aborted; failures += 1) {
			if (delayMs > 0) await pause(delayMs);
			if (signal.aborted) return false;
			hurried = false;
			if (await attempt()) return !signal.aborted;
			delayMs = hurried ? 0 : reconnectBackoffMs(failures);
		}
		return false;
	};

	return {
		done: run(),
		retryNow: () => {
			hurried = true;
			interrupt?.();
		},
	};
}
