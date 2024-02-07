import type { ObjectId } from "mongodb";
import type { Message } from "./Message";

export interface Branch {
	_id: ObjectId;
	parents: Branch["_id"][];
	messages: Message[];
}
