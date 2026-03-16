import type { ObjectId } from "mongodb";
import type { User } from "./User";
import type { Timestamps } from "./Timestamps";

export interface Project extends Timestamps {
	_id: ObjectId;

	sessionId?: string;
	userId?: User["_id"];

	name: string;
	description?: string;

	/** Custom instructions applied to all conversations in this project */
	preprompt?: string;

	/** Default model for new conversations in this project */
	modelId?: string;
}
