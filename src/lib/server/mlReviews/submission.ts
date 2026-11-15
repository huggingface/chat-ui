import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { MlReview } from "$lib/types/MlReview";
import type { MlFileRef } from "$lib/types/MlFile";
import { ensureReviewFiles, ensureReviewResult } from "./result";
import { logger } from "$lib/server/logger";
import {
	clearUnresolved,
	queueDelivery,
	recordSubmitFailure,
	resolveSubmittedReview,
	unresolvedSubmissions,
} from "./store";

/** a repeat that lost the resolve to its own first attempt, not to a message that closed the call */
async function alreadyAccepted(review: Pick<MlReview, "conversationId" | "elicitationId">) {
	const row = await collections.mcpElicitations.findOne(
		{ elicitationId: review.elicitationId, conversationId: review.conversationId },
		{ projection: { status: 1, action: 1, resolution: 1 } }
	);
	return row?.status === "resolved" && row.action === "accept" && row.resolution === "user";
}

/** with a destination the result waits for the push in the resume or delivery, a commit can take a minute */
export async function completeSubmission(
	review: MlReview
): Promise<{ files: MlFileRef[]; resolved: boolean }> {
	const files = review.destination
		? await ensureReviewFiles(review)
		: (await ensureReviewResult(review)).files;
	const resolved = review.unresolved
		? (await resolveSubmittedReview(review, review.submittedAt ?? new Date())) ||
			(await alreadyAccepted(review))
		: false;
	if (!resolved) await queueDelivery(review);
	if (review.unresolved) await clearUnresolved(review);
	return { files, resolved };
}

/** submissions a process claimed and died on, finished for the settle and the sweep */
export async function finishStoredSubmissions(conversationId?: ObjectId): Promise<void> {
	for (const review of await unresolvedSubmissions(conversationId)) {
		try {
			await completeSubmission(review);
		} catch (err) {
			logger.error({ err, reviewId: review._id.toString() }, "[review] recovery failed");
			await recordSubmitFailure(review, err instanceof Error ? err.message : String(err)).catch(
				() => undefined
			);
		}
	}
}
