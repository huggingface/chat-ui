import { ObjectId, type Filter } from "mongodb";
import { collections } from "$lib/server/database";
import type {
	MlReview,
	ReviewDraft,
	ReviewRecord,
	ReviewSchema,
	ReviewSource,
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
	draft: ReviewDraft,
	/** the record revision the draft was edited from, absent saves over whatever is there */
	baseRevision?: number
): Promise<"saved" | "closed" | "conflict"> {
	const _id = reviewObjectId(reviewId);
	if (!_id || !Number.isInteger(index) || index < 0) return "closed";
	const path = `drafts.${index}`;
	const now = new Date();
	// a detached review stays open for drafting, only its submission changes shape
	const open: Filter<MlReview> = {
		_id,
		conversationId,
		status: { $in: ["open", "detached"] },
	};
	const updated = await collections.mlReviews.updateOne(
		{
			...open,
			...(baseRevision === undefined
				? {}
				: baseRevision === 0
					? { [`${path}.revision`]: { $exists: false } }
					: { [`${path}.revision`]: baseRevision }),
		},
		{ $set: { [path]: draft, updatedAt: now }, $inc: { draftRevision: 1 } }
	);
	if (updated.matchedCount === 1) return "saved";
	return (await collections.mlReviews.countDocuments(open)) > 0 ? "conflict" : "closed";
}

/** claims the submission from the status and draft revision it read, so a race changes nothing */
export async function submitReview(
	review: Pick<MlReview, "_id" | "conversationId" | "draftRevision">,
	submission: {
		note?: string;
		/** drafts written in the same update as the claim, keyed by record position */
		drafts?: Record<string, ReviewDraft>;
	},
	from: MlReview["status"] = "open"
): Promise<boolean> {
	const now = new Date();
	const drafts = Object.fromEntries(
		Object.entries(submission.drafts ?? {}).map(([index, draft]) => [`drafts.${index}`, draft])
	);
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
				...(submission.note ? { note: submission.note } : {}),
				...(from === "open"
					? { unresolved: true as const }
					: { delivery: { status: "pending" as const, attempts: 0 } }),
				...drafts,
				submittedAt: now,
				updatedAt: now,
			},
		}
	);
	return updated.matchedCount === 1;
}

/** first writer wins, a second builder of the same submission reads the stored one back */
export async function storeReviewResult(
	review: Pick<MlReview, "_id">,
	result: NonNullable<MlReview["result"]>
): Promise<NonNullable<MlReview["result"]>> {
	await collections.mlReviews.updateOne(
		{ _id: review._id, status: "submitted", result: { $exists: false } },
		{ $set: { result, updatedAt: new Date() } }
	);
	const stored = await collections.mlReviews.findOne(
		{ _id: review._id },
		{ projection: { result: 1 } }
	);
	return stored?.result ?? result;
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

/** a claimed submission whose parked call was closed meanwhile goes out as a message instead */
export async function queueDelivery(review: Pick<MlReview, "_id">): Promise<void> {
	await collections.mlReviews.updateOne(
		{ _id: review._id, status: "submitted", delivery: { $exists: false } },
		{ $set: { delivery: { status: "pending", attempts: 0 }, updatedAt: new Date() } }
	);
}

export async function clearUnresolved(review: Pick<MlReview, "_id">): Promise<void> {
	await collections.mlReviews.updateOne({ _id: review._id }, { $unset: { unresolved: "" } });
}

/** claimed submissions a process left unresolved, oldest first, so none can starve the rest */
export async function unresolvedSubmissions(
	conversationId?: ObjectId,
	limit = 50
): Promise<MlReview[]> {
	return collections.mlReviews
		.find({ ...(conversationId ? { conversationId } : {}), unresolved: true })
		.sort({ submittedAt: 1 })
		.limit(limit)
		.toArray();
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
