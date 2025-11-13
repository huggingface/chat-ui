import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";

export async function* generateTitleForConversation(
	conv: Conversation,
	_locals: App.Locals | undefined
): AsyncGenerator<MessageUpdate, undefined, undefined> {
	const userMessage = conv.messages.find((m) => m.from === "user");
	// HACK: detect if the conversation is new
	if (conv.title !== "New Chat" || !userMessage) {
		return;
	}

	const prompt = userMessage.content;
	const title = generateTitle(prompt) ?? "New Chat";

	yield {
		type: MessageUpdateType.Title,
		title,
	};
}

function generateTitle(prompt: string) {
	// Always use the first five words for title generation
	return prompt.split(/\s+/g).slice(0, 5).join(" ");
}

// No post-processing: rely solely on prompt instructions above
