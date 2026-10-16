import { json, type RequestHandler } from "@sveltejs/kit";
import { ownedReview, submitReviewRequest } from "$lib/server/mlReviews/api";

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const review = await ownedReview(locals, params.id ?? "", params.reviewId ?? "");
	const outcome = await submitReviewRequest(review, await request.json().catch(() => null));
	if ("blockers" in outcome) {
		return json(
			{ message: "Some records still need answers.", blockers: outcome.blockers },
			{ status: 400 }
		);
	}
	return json(outcome);
};
