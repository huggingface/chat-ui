import type { ObjectId } from "mongodb";
import type { Message } from "./Message";
import type { Timestamps } from "./Timestamps";

export interface Conversation extends Timestamps {
	_id: ObjectId;

	// Can be undefined for shared convo then deleted
	sessionId: string;

	title: string;
	messages: Message[];

	meta?: {
		fromShareId?: string;
	};
}
