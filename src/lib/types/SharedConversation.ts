import type { Message } from "./Message";

export interface SharedConversation {
	_id: string;

	hash: string;

	title: string;
	messages: Message[];

	createdAt: Date;
	updatedAt: Date;
}
