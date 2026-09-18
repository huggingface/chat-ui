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
