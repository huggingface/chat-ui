import { writable } from "svelte/store";

/**
 * A parked MCP call whose prompt the user has just answered, waiting for its conversation
 * page to start the run that continues it — the form is nested too deeply to hand it a
 * callback. Never set for the model's own questions: the server continues those itself. Carries the conversation because this store outlives navigation: the page
 * component is reused across conversations, so an unscoped id would resume in whichever
 * one happens to be open.
 */
export const elicitationToResume = writable<{
	conversationId: string;
	elicitationId: string;
	/** The assistant turn the call parked on; the page's own last message may not be it. */
	messageId?: string;
} | null>(null);
