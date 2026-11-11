import { writable } from "svelte/store";
import type { TrackioDashboardView } from "$lib/utils/trackioView";
import type { PaperQuote } from "$lib/utils/paper";

export interface ComposerPayload {
	/** Attachments to append to the composer's file list */
	files?: File[];
	/** Text appended to the current draft, still editable before sending */
	text?: string;
	dashboardViews?: TrackioDashboardView[];
	/** passages selected in the paper reader, inserted as chips */
	paperQuotes?: PaperQuote[];
}

/**
 * Content queued for the chat composer from outside ChatWindow (e.g. an
 * annotated artifact screenshot plus its numbered notes). ChatWindow consumes
 * and clears this on arrival: files join the attachment list, text is
 * appended to the draft.
 */
export const pendingComposerPayload = writable<ComposerPayload | undefined>(undefined);
