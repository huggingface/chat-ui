import type { Conversation } from "$lib/types/Conversation";
import type { Settings } from "$lib/types/Settings";

export interface StoredConversation extends Omit<Conversation, "_id" | "sessionId" | "userId"> {
	id: string;
}

export interface StoredSettings extends Omit<Settings, "userId" | "sessionId"> {
	id: string;
}

export interface StoredFile {
	id: string;
	conversationId: string;
	hash: string;
	data: Blob;
	mime: string;
	name: string;
	createdAt: Date;
}

export interface StorageDatabase {
	conversations: StoredConversation[];
	files: StoredFile[];
	settings: StoredSettings[];
}
