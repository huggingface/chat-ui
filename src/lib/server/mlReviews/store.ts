import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type {
	MlReview,
	ReviewDraft,
	ReviewRecord,
	ReviewSchema,
	ReviewSource,
	ReviewVerdict,
} from "$lib/types/MlReview";

/** records are snapshotted here, never into the conversation document */

export const reviewObjectId = (reviewId: string): ObjectId | undefined =>
	ObjectId.isValid(reviewId) && /^[0-9a-f]{24}$/i.test(reviewId)
		? new ObjectId(reviewId)
		: undefined;

export async function createReview(params: {
	conversationId: ObjectId;
	messageId: string;
	toolCallId: string;
	toolUuid: string;
	elicitationId: string;
	schema: ReviewSchema;
	schemaHash: string;
	source: ReviewSource;
	records: ReviewRecord[];
}): Promise<MlReview> {
	const now = new Date();
	const review: MlReview = {
		_id: new ObjectId(),
		...params,
		drafts: {},
		draftRevision: 0,
		status: "open",
		createdAt: now,
		updatedAt: now,
	};
	await collections.mlReviews.insertOne(review);
	return review;
}

export async function readReview(
	conversationId: ObjectId,
	reviewId: string
): Promise<MlReview | null> {
	const _id = reviewObjectId(reviewId);
	if (!_id) return null;
	return collections.mlReviews.findOne({ _id, conversationId });
}

/** keyed by position, so a model-chosen id never becomes a Mongo key */
export async function saveDraft(
	conversationId: ObjectId,
	reviewId: string,
	index: number,
	draft: ReviewDraft
): Promise<boolean> {
	const _id = reviewObjectId(reviewId);
	if (!_id || !Number.isInteger(index) || index < 0) return false;
	const now = new Date();
	// a detached review stays open for drafting, only its submission changes shape
	const updated = await collections.mlReviews.updateOne(
		{ _id, conversationId, status: { $in: ["open", "detached"] } },
		{ $set: { [`drafts.${index}`]: draft, updatedAt: now }, $inc: { draftRevision: 1 } }
	);
	return updated.matchedCount === 1;
}

/** from the status and draft revision the result was built on, so a race changes nothing */
export async function submitReview(
	review: Pick<MlReview, "_id" | "conversationId" | "draftRevision">,
	submission: { verdict: ReviewVerdict; summary?: string; result: NonNullable<MlReview["result"]> },
	from: MlReview["status"] = "open"
): Promise<boolean> {
	const now = new Date();
	const updated = await collections.mlReviews.updateOne(
		{
			_id: review._id,
			conversationId: review.conversationId,
			status: from,
			draftRevision: review.draftRevision,
		},
		{
			$set: {
				status: "submitted",
				verdict: submission.verdict,
				...(submission.summary ? { summary: submission.summary } : {}),
				result: submission.result,
				submittedAt: now,
				updatedAt: now,
			},
		}
	);
	return updated.matchedCount === 1;
}

/** answers the parked call from a stored submission, false once anything else closed it */
export async function resolveSubmittedReview(
	review: Pick<MlReview, "conversationId" | "elicitationId">,
	resolvedAt = new Date()
): Promise<boolean> {
	const updated = await collections.mcpElicitations.updateOne(
		{
			elicitationId: review.elicitationId,
			conversationId: review.conversationId,
			status: "pending",
			"pending.kind": "review",
		},
		{
			$set: {
				status: "resolved",
				action: "accept",
				resolution: "user",
				resolvedAt,
				updatedAt: new Date(),
			},
		}
	);
	return updated.matchedCount === 1;
}

/** resolves pending rows of submitted reviews, a submit can die between its two writes */
export async function finishStoredSubmissions(conversationId?: ObjectId): Promise<void> {
	const rows = await collections.mcpElicitations
		.find(
			{
				...(conversationId ? { conversationId } : {}),
				status: "pending",
				"pending.kind": "review",
			},
			{ projection: { conversationId: 1, pending: 1 } }
		)
		.limit(50)
		.toArray();
	for (const row of rows) {
		if (row.pending?.kind !== "review") continue;
		const review = await readReview(row.conversationId, row.pending.reviewId);
		if (review?.status !== "submitted") continue;
		await resolveSubmittedReview(review, review.submittedAt);
	}
}

/** the user wrote instead, the review stays answerable and its submission becomes a message */
export async function detachReview(conversationId: ObjectId, reviewId: string): Promise<boolean> {
	const _id = reviewObjectId(reviewId);
	if (!_id) return false;
	const now = new Date();
	const updated = await collections.mlReviews.updateOne(
		{ _id, conversationId, status: "open" },
		{ $set: { status: "detached", detachedAt: now, updatedAt: now } }
	);
	return updated.matchedCount === 1;
}

export async function expireReview(conversationId: ObjectId, reviewId: string): Promise<boolean> {
	const _id = reviewObjectId(reviewId);
	if (!_id) return false;
	const now = new Date();
	const updated = await collections.mlReviews.updateOne(
		{ _id, conversationId, status: "open" },
		{ $set: { status: "expired", expiredAt: now, updatedAt: now } }
	);
	return updated.matchedCount === 1;
}

export async function listOpenReviews(
	conversationId: ObjectId
): Promise<Pick<MlReview, "_id" | "schema" | "drafts" | "status" | "records">[]> {
	return collections.mlReviews
		.aggregate<Pick<MlReview, "_id" | "schema" | "drafts" | "status" | "records">>([
			{ $match: { conversationId, status: { $in: ["open", "detached"] } } },
			{ $sort: { createdAt: 1 } },
			{
				$project: {
					schema: 1,
					drafts: 1,
					status: 1,
					// only the count is read
					records: { $map: { input: "$records", as: "r", in: { id: "$$r.id" } } },
				},
			},
		])
		.toArray();
}

/** a conversation owns its reviews, so every path that deletes one calls this */
export async function deleteMlReviewsOf(conversationIds: ObjectId[]): Promise<void> {
	if (conversationIds.length === 0) return;
	await collections.mlReviews.deleteMany({ conversationId: { $in: conversationIds } });
}
