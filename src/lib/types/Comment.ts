import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";
import type { Conversation } from "./Conversation";

export interface Comment extends Timestamps {
	_id: ObjectId;

	sessionId?: string;
	userId?: User["_id"];

    // Conversation
    conversationId?: Conversation["_id"];

    content: string;
    // Annotation text quote selector
    textQuoteSelector?: {
        exact: string;
        prefix?: string;
        suffix?: string;
    };

    // Annotation text position selector
    textPositionSelector?: {
        start: number;
        end: number;
    };
}
