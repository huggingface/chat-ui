import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

/** queued until a tool round, a wait resume or the next turn takes it, each a CAS so it is read once */
export interface QueuedInput extends Timestamps {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	text: string;
	status: "queued" | "delivered" | "started" | "cancelled";
	source: "web" | "slack";
	/** the identity a turn started from the queue runs as, there is no request behind it */
	userId?: User["_id"];
	sessionId?: string;
	/** the assistant message it was read into, for `delivered` */
	messageId?: string;
	claimToken?: string;
	takenAt?: Date;
	/** turns started from it that were refused before they ran */
	attempts?: number;
}

export interface QueuedInputView {
	id: string;
	text: string;
	status: QueuedInput["status"];
	createdAt: number;
}
