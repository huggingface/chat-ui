import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export interface ConversationGroup extends Timestamps {
	_id: ObjectId;
	userId?: User["_id"];
	sessionId?: string;
	name: string;
	isCollapsed: boolean;
}
