import { writable } from "svelte/store";

export interface ComposerPayload {
	/** Attachments to append to the composer's file list */
	files?: File[];
	/** Text appended to the current draft, still editable before sending */
	text?: string;
}

/**
 * Content queued for the chat composer from outside ChatWindow (e.g. an
 * annotated artifact screenshot plus its numbered notes). ChatWindow consumes
 * and clears this on arrival: files join the attachment list, text is
 * appended to the draft.
 */
export const pendingComposerPayload = writable<ComposerPayload | undefined>(undefined);
