import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export interface MessageEvent extends Pick<Timestamps, "createdAt"> {
	userId: User["_id"] | User["sessionId"];
	ip?: string;
}
