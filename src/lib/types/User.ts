import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface User extends Timestamps {
	_id: ObjectId;
	lastSeenAt: Date;
	requestCount: number;

	username: string;
	name: string;
	avatarUrl: string;
	hfUserId: string;

	// Session identifier, stored in the cookie
	sessionId: string;
}
