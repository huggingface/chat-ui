import type { Message } from "$lib/types/Message";
import { MessageUpdateStatus, MessageUpdateType } from "$lib/types/MessageUpdate";

export function isAssistantGenerationTerminal(message?: Message): boolean {
	if (!message || message.from !== "assistant") return true;

	if (message.interrupted === true) return true;

	const updates = message.updates ?? [];
	const hasFinalAnswer = updates.some((update) => update.type === MessageUpdateType.FinalAnswer);
	if (hasFinalAnswer) return true;

	return updates.some(
		(update) =>
			update.type === MessageUpdateType.Status &&
			(update.status === MessageUpdateStatus.Error ||
				update.status === MessageUpdateStatus.Finished)
	);
}

export function isConversationGenerationActive(messages: Message[]): boolean {
	const lastAssistant = [...messages].reverse().find((message) => message.from === "assistant");
	if (!lastAssistant) return false;

	return !isAssistantGenerationTerminal(lastAssistant);
}

/**
 * How long a generation may go without any database write before it is
 * considered dead. Conversation.updatedAt is bumped when a generation starts
 * (the pre-stream message write) and when it ends (persistConversation), so a
 * conversation that has stayed non-terminal longer than this belongs to a pod
 * that crashed before persisting — it will never become terminal on its own
 * and must not keep the UI in a generating state forever.
 */
export const GENERATION_STALE_MS = 10 * 60 * 1000;

export function isGenerationStale(lastWriteAt: Date | string | undefined): boolean {
	if (!lastWriteAt) return false;
	const t = new Date(lastWriteAt).getTime();
	return !Number.isNaN(t) && Date.now() - t > GENERATION_STALE_MS;
}
