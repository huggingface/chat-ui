import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface AllowedConversation extends Pick<Timestamps, "createdAt"> {
	convId: Conversation["_id"];
}
