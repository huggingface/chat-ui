import type { Conversation } from "$lib/types/Conversation";

export function convertLegacyConversation(
	conv: Pick<Conversation, "_id" | "messages" | "rootMessageId">
): Pick<Conversation, "_id" | "messages" | "rootMessageId"> {
	if (conv.rootMessageId) return conv; // not a legacy conversation

	const messages = conv.messages;

	const rootMessageId = messages[0].id;

	const newMessages = messages.map((message, index) => {
		return {
			...message,
			ancestors: messages.slice(0, index).map((m) => m.id),
		};
	});

	return {
		...conv,
		rootMessageId,
		messages: newMessages,
	};
}
