import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";

/**
 * one version of a virtual file, files belong to the conversation not a branch, every
 * write or edit is a new document and the latest is the highest version
 */
export interface MlFile {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	name: string;
	/** 1 based, unique with conversationId and name */
	version: number;
	content: string;
	/** utf8 bytes of content */
	size: number;
	sha256: string;
	origin: "write" | "edit";
	createdAt: Date;
	messageId?: Message["id"];
	generationId?: string;
	/** uuid of the tool call that produced this version */
	toolUuid?: string;
	/** one line the model gave */
	summary?: string;
}
