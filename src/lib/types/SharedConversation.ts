import type { Message } from "./Message";
import type { Timestamps } from "./Timestamps";

export interface SharedConversation extends Timestamps {
	_id: string;

	hash: string;

	model: string;
	title: string;
	messages: Message[];
}
