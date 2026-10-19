import type { ObjectId } from "mongodb";
import type { MlReview } from "$lib/types/MlReview";
import { ensureReviewResult } from "./result";
import { clearUnresolved, resolveSubmittedReview, unresolvedSubmissions } from "./store";

/** builds the result of a claimed submission and answers its parked call, safe to repeat */
export async function completeSubmission(
	review: MlReview
): Promise<{ result: NonNullable<MlReview["result"]>; resolved: boolean }> {
	const result = await ensureReviewResult(review);
	if (!review.unresolved) return { result, resolved: false };
	const resolved = await resolveSubmittedReview(review, review.submittedAt ?? new Date());
	await clearUnresolved(review);
	return { result, resolved };
}

/** submissions a process claimed and died on, finished for the settle and the sweep */
export async function finishStoredSubmissions(conversationId?: ObjectId): Promise<void> {
	for (const review of await unresolvedSubmissions(conversationId)) {
		await completeSubmission(review);
	}
}
