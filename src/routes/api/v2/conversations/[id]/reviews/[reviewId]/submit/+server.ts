import { error, json, type RequestHandler } from "@sveltejs/kit";
import { ownedReview, submitReviewRequest } from "$lib/server/mlReviews/api";
import { isDetachedSlackReview } from "$lib/server/slack/readOnly";

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const review = await ownedReview(locals, params.id ?? "", params.reviewId ?? "");
	if (review.status !== "submitted" && (await isDetachedSlackReview(review))) {
		error(409, "This review is closed because the Slack thread moved on. Continue in Slack.");
	}
	const outcome = await submitReviewRequest(review, await request.json().catch(() => null));
	if ("blockers" in outcome) {
		return json(
			{ message: "Some answers are not valid.", blockers: outcome.blockers },
			{ status: 400 }
		);
	}
	return json(outcome);
};
