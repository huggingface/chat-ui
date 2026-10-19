import { json, type RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { ownedReview, patchDraft, reviewPayload } from "$lib/server/mlReviews/api";

export const GET: RequestHandler = async ({ locals, params }) => {
	const review = await ownedReview(locals, params.id ?? "", params.reviewId ?? "");
	return superjsonResponse(reviewPayload(review));
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const review = await ownedReview(locals, params.id ?? "", params.reviewId ?? "");
	const saved = await patchDraft(review, await request.json().catch(() => null));
	if ("conflict" in saved) {
		return superjsonResponse(
			{
				message: "This record was changed elsewhere, its current draft is attached.",
				draft: saved.conflict,
			},
			{ status: 409 }
		);
	}
	return json({ ok: true, ...saved });
};
