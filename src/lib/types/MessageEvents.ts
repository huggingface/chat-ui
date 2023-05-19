import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Message } from "./Message";

export interface MessageEvents {
	_id: ObjectId;

	createdAt: Date;
	userId: User["_id"];
	messageId: Message["id"];
}
