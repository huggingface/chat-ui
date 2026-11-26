import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";

export interface User extends Timestamps {
	_id: ObjectId;

	username?: string;
	name: string;
	email?: string;
	avatarUrl: string | undefined;
	hfUserId: string;
	/** Internal bot identity, never an OAuth user. Credentials stay in server configuration. */
	slackBotTeamId?: string;
	isAdmin?: boolean;
	isEarlyAccess?: boolean;
	/** set by an out of credits 402, cleared by the next completed turn */
	outOfCreditsAt?: Date;
}
