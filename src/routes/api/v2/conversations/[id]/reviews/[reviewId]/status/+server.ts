import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { ownedReviewStatus, reviewStatusPayload } from "$lib/server/mlReviews/api";

export const GET: RequestHandler = async ({ locals, params }) => {
	const review = await ownedReviewStatus(locals, params.id ?? "", params.reviewId ?? "");
	return superjsonResponse(reviewStatusPayload(review));
};
