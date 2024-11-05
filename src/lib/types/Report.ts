import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Assistant } from "./Assistant";
import type { Timestamps } from "./Timestamps";

export interface Report extends Timestamps {
	_id: ObjectId;
	createdBy: User["_id"] | string;
	assistantId: Assistant["_id"];
	reason?: string;
}
