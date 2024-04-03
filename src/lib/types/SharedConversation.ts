import type { Conversation } from "./Conversation";

export type SharedConversation = Pick<
	Conversation,
	| "model"
	| "embeddingModel"
	| "title"
	| "rootMessageId"
	| "messages"
	| "preprompt"
	| "assistantId"
	| "createdAt"
	| "updatedAt"
> & {
	_id: string;
	hash: string;
};
