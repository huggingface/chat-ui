import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import { addChildren } from "./addChildren";

export function addSibling(
	conv: Pick<Conversation, "messages" | "rootMessageId">,
	message: Omit<Message, "id">,
	siblingId: Message["id"]
): Message["id"] {
	if (conv.messages.length === 0) {
		throw new Error("Cannot add a sibling to an empty conversation");
	}
	if (!conv.rootMessageId) {
		throw new Error("Cannot add a sibling to a legacy conversation");
	}

	const sibling = conv.messages.find((m) => m.id === siblingId);

	if (!sibling) {
		throw new Error("The sibling message doesn't exist");
	}

	if (!sibling.ancestors || sibling.ancestors?.length === 0) {
		throw new Error("The sibling message is the root message, therefore we can't add a sibling");
	}

	return addChildren(conv, message, sibling.ancestors[sibling.ancestors.length - 1]);
}
