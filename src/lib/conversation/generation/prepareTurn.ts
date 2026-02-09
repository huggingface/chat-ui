import { addChildren } from "$lib/utils/tree/addChildren";
import { addSibling } from "$lib/utils/tree/addSibling";
import type { Tree, TreeId } from "$lib/utils/tree/tree";
import type { Message } from "$lib/types/Message";

export type PreparedTurn = {
	assistantMessageId: Message["id"];
	promptAnchorId: Message["id"];
	excludeAnchorFromPrompt: boolean;
};

type NewConversationMessage = Omit<Message, "id" | "ancestors" | "children">;

type PrepareTurnInput = {
	tree: Tree<Message>;
	messageId?: TreeId;
	prompt?: string;
	isRetry?: boolean;
	files?: Message["files"];
	createUserMessage: (params: {
		prompt: string;
		files?: Message["files"];
		retryTarget?: Message;
	}) => NewConversationMessage;
	createAssistantMessage: (params?: { retryTarget?: Message }) => NewConversationMessage;
};

export function prepareTurn({
	tree,
	messageId,
	prompt,
	isRetry = false,
	files,
	createUserMessage,
	createAssistantMessage,
}: PrepareTurnInput): PreparedTurn {
	if (isRetry && messageId) {
		const messageToRetry = tree.messages.find((message) => message.id === messageId);
		if (!messageToRetry) {
			throw new Error("Message not found");
		}

		if (messageToRetry.from === "user") {
			if (!prompt) {
				throw new Error("Retrying a user message requires a new prompt");
			}

			const newUserMessageId = addSibling(
				tree,
				createUserMessage({ prompt, files, retryTarget: messageToRetry }),
				messageId
			);

			const assistantMessageId = addChildren(
				tree,
				createAssistantMessage({ retryTarget: messageToRetry }),
				newUserMessageId
			);

			return {
				assistantMessageId,
				promptAnchorId: newUserMessageId,
				excludeAnchorFromPrompt: false,
			};
		}

		if (messageToRetry.from === "assistant") {
			const assistantMessageId = addSibling(
				tree,
				createAssistantMessage({ retryTarget: messageToRetry }),
				messageId
			);

			return {
				assistantMessageId,
				promptAnchorId: messageId,
				excludeAnchorFromPrompt: true,
			};
		}
	}

	const newUserMessageId = addChildren(
		tree,
		createUserMessage({ prompt: prompt ?? "", files }),
		messageId
	);

	const assistantMessageId = addChildren(tree, createAssistantMessage(), newUserMessageId);

	return {
		assistantMessageId,
		promptAnchorId: newUserMessageId,
		excludeAnchorFromPrompt: false,
	};
}
