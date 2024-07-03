import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";
import type { Conversation } from "./Conversation";
import type { WrapperObject } from 'wrap-range-text';

// Base Comment type (as stored in MongoDB)
export interface Comment extends Timestamps {
    _id: ObjectId;
    sessionId?: string;
    userId?: User["_id"];
    conversationId?: Conversation["_id"];
    content: string;
    textQuoteSelector?: {
        exact: string;
        prefix?: string;
        suffix?: string;
    };
    textPositionSelector?: {
        start: number;
        end: number;
    };
}

// DisplayComment type for use in the application
export interface DisplayComment {
    _id?: ObjectId;
    sessionId?: string;
    userId?: User["_id"];
    conversationId?: Conversation["_id"];
    content: string;
    createdAt?: Date;
    updatedAt?: Date;
    textQuoteSelector?: {
        exact: string;
        prefix?: string;
        suffix?: string;
    };
    textPositionSelector?: {
        start: number;
        end: number;
    };
    wrapperObject?: WrapperObject;
    isPending: boolean;
    originalContent?: string;
}
