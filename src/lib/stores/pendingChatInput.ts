import { writable } from "svelte/store";

export interface PendingChatInput {
	text: string;
	/** Send the message immediately instead of only filling the chat input */
	submit?: boolean;
}

export const pendingChatInput = writable<PendingChatInput | undefined>(undefined);
