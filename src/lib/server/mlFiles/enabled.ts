import type { Conversation } from "$lib/types/Conversation";
import { config } from "$lib/server/config";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";

/**
 * one switch for the tools, the expansion and the prompt text, a model taught to write
 * v-file into a call nothing expands would start a job on a literal, mode conversations
 * only and on unless ML_ASSISTANT_VIRTUAL_FILES is false
 */
export function mlVirtualFilesEnabled(conv: Pick<Conversation, "mlAssistant">): boolean {
	return isMlAssistantConversation(conv) && config.ML_ASSISTANT_VIRTUAL_FILES !== "false";
}
