import type { Conversation } from "$lib/types/Conversation";

export function convertLegacyConversation(
	conv: Pick<Conversation, "messages" | "rootMessageId">
): Pick<Conversation, "messages" | "rootMessageId"> {
	if (conv.rootMessageId) return conv; // not a legacy conversation
	if (conv.messages.length === 0) return conv; // empty conversation
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
