import { writable } from "svelte/store";

/**
 * Files queued for the chat composer from outside ChatWindow (e.g. an artifact
 * preview screenshot). ChatWindow appends them to its attachment list and
 * clears the store on arrival.
 */
export const pendingChatFiles = writable<File[] | undefined>(undefined);
