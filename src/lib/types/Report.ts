import type { User } from "./User";
import type { Assistant } from "./Assistant";
import type { Timestamps } from "./Timestamps";

export interface Report extends Timestamps {
	_id: string;
	createdBy: User["_id"] | string;
	object: "assistant" | "tool";
	contentId: Assistant["_id"];
	reason?: string;
}
