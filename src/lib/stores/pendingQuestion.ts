import { writable, derived } from "svelte/store";
import type { ElicitationRequestPayload } from "$lib/types/McpElicitation";

export interface PendingQuestion {
	conversationId: string;
	request: ElicitationRequestPayload;
}

/**
 * A list rather than one slot: a later turn can ask while an earlier question is still
 * open, and one slot would let the newer hide the older, which could then never be answered.
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

export const pendingQuestions = derived(questions, ($questions) => $questions);

export const firstQuestionFor = (conversationId: string | undefined) =>
	derived(questions, ($questions) =>
		conversationId ? ($questions.find((q) => q.conversationId === conversationId) ?? null) : null
	);
