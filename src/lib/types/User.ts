import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface User extends Timestamps {
	_id: ObjectId;

	username: string;
	name: string;
	email?: string;
	avatarUrl: string;
	providerUserId: string;

	// Session identifier, stored in the cookie
	sessionId: string;
}
