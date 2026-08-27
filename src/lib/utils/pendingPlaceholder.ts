import type { Message } from "$lib/types/Message";

/**
 * It fills the gap before the first token, so it must not appear when something on screen
 * will already receive that stream: the blank message a send appends, or — with content,
 * so the blank test misses it — the parked message a resumed call continues.
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
