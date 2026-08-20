import { writable } from "svelte/store";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";

/**
 * The question the run is waiting on, lifted out of the transcript so it can be shown over
 * the composer. Carries its conversation, or opening a second chat would answer this one's
 * question in the wrong place.
 */
export const pendingQuestion = writable<{
	conversationId: string;
	request: ElicitationRequestPayload;
} | null>(null);
