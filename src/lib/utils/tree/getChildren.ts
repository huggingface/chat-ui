import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";

export function getChildren(
	conv: Pick<Conversation, "messages" | "rootMessageId">,
	id: Message["id"]
): Message[] {
	if (!conv.messages.length || conv.messages.findIndex((msg) => msg.id === id) === -1) {
		throw new Error("Message not found");
	}
	// legacy linear conversations
	if (!conv.rootMessageId) {
		// pick the next message after the one with the given id if it exists
		const index = conv.messages.findIndex((msg) => msg.id === id);
		if (index === -1) {
			return [];
		}
		return conv.messages[index + 1] ? [conv.messages[index + 1]] : [];
	}

	// find the direct children of the message using the ancestors array of other elements, only add direct children, so it has to be the rightmost ancestor
	return conv.messages.filter((msg) => {
		const ancestors = msg.ancestors;
		if (!ancestors || !ancestors.length) {
			return false;
		} else {
			return ancestors[ancestors.length - 1] === id;
		}
	});
}
