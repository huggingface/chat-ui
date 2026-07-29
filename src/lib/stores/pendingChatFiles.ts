import { writable } from "svelte/store";

/**
 * Files queued for the chat composer from outside ChatWindow (e.g. an artifact
 * preview screenshot). ChatWindow appends them to its attachment list and
 * clears the store, mirroring how pendingChatInput prefills the text draft.
 */
export const pendingChatFiles = writable<File[] | undefined>(undefined);
