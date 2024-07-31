import type { ObjectId } from "mongodb";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";
import type { Conversation } from "./Conversation";
import type { WrapperObject } from 'wrap-range-text';

// Base Comment type as stored in the database
export interface Comment extends Timestamps {
    _id: ObjectId;
    userId?: User["_id"];
    content: string;
    parentCommentId?: ObjectId;
    childCommentId?: ObjectId;
}

// DisplayComment type as displayed in the app
export interface DisplayComment extends Omit<Comment, '_id'> {
    _id: ObjectId | null;
    originalContent?: string;
    username?: string;
    isPending: boolean;
}

// CommentThread type (as stored in MongoDB)
export interface CommentThread extends Timestamps {
    _id: ObjectId;
    userId?: User["_id"];
    conversationId: Conversation["_id"];
    comments: Comment[];
    textQuoteSelector: {
        exact: string;
        prefix?: string;
        suffix?: string;
    };
    textPositionSelector: {
        start: number;
        end: number;
    };
}

// DisplayCommentThread type for use in the application
export interface DisplayCommentThread extends Omit<CommentThread, 'comments' | '_id' | 'conversationId'> {
    _id: ObjectId | null;
    username?: string;
    conversationId?: Conversation["_id"];
    comments: DisplayComment[];
    wrapperObject?: WrapperObject;
    isPending: boolean;
}
