import { writable, derived } from "svelte/store";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";

export interface PendingQuestion {
	conversationId: string;
	request: ElicitationRequestPayload;
}

/**
 * Questions the run is waiting on, lifted out of the transcript so they can be shown over
 * the composer. A list rather than one slot: nothing stops a later turn asking while an
 * earlier question is still open, and a single slot would let the newer one hide the older
 * — which then has no way to be answered and leaves its tool call without a result.
 */
const questions = writable<PendingQuestion[]>([]);

export function registerQuestion(conversationId: string, request: ElicitationRequestPayload) {
	questions.update((current) =>
		current.some((q) => q.request.elicitationId === request.elicitationId)
			? current
			: [...current, { conversationId, request }]
	);
}

export function unregisterQuestion(elicitationId: string) {
	questions.update((current) => current.filter((q) => q.request.elicitationId !== elicitationId));
}

/** Carries its conversation, or opening a second chat would answer this one's question there. */
export const pendingQuestions = derived(questions, ($questions) => $questions);

/** The oldest unanswered one, so questions are worked through in the order they were asked. */
export const firstQuestionFor = (conversationId: string | undefined) =>
	derived(questions, ($questions) =>
		conversationId ? ($questions.find((q) => q.conversationId === conversationId) ?? null) : null
	);
