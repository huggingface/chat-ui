import type { Message } from "$lib/types/Message";

/**
 * Whether to draw a placeholder bubble for a request that has not started streaming.
 *
 * It exists for the gap between sending and the first token, so it must not appear when
 * something on screen is already going to receive that stream: the blank assistant message
 * a normal send appends, or — with content, so the blank test misses it — the parked
 * message a resumed call continues.
 */
export function shouldShowPendingPlaceholder({
	pending,
	resuming,
	lastMessage,
}: {
	pending: boolean;
	resuming: boolean;
	lastMessage?: Pick<Message, "from" | "content">;
}): boolean {
	if (!pending || resuming) return false;
	return !(lastMessage?.from === "assistant" && (lastMessage.content ?? "").length === 0);
}
