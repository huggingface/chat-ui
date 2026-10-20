import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";
import type { AskResumeSelection } from "$lib/server/generation/askResume";
import type { MlReview } from "$lib/types/MlReview";

/** a live attempt posts in seconds, so this only expires under a process that died */
const DELIVERY_LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const SWEEP_BATCH = 5;

export type DeliveryState = "sent" | "queued" | "failed";

const stateOf = (review: Pick<MlReview, "delivery"> | null): DeliveryState =>
	review?.delivery?.status === "sent"
		? "sent"
		: review?.delivery?.status === "failed"
			? "failed"
			: "queued";

async function claim(reviewId: ObjectId): Promise<MlReview | null> {
	const now = new Date();
	const claimed = await collections.mlReviews.findOneAndUpdate(
		{
			_id: reviewId,
			status: "submitted",
			$or: [
				{ "delivery.status": "pending" },
				{
					"delivery.status": "sending",
					"delivery.takenAt": { $lt: new Date(now.getTime() - DELIVERY_LEASE_MS) },
				},
			],
		},
		{
			$set: { "delivery.status": "sending", "delivery.takenAt": now, updatedAt: now },
			$inc: { "delivery.attempts": 1 },
		},
		{ returnDocument: "after" }
	);
	return claimed.value ?? null;
}

/** keyed on the claim taken, so a holder that stalled past its lease cannot undo its successor */
const held = (review: MlReview) => ({
	_id: review._id,
	"delivery.status": "sending",
	"delivery.takenAt": review.delivery?.takenAt,
});

async function markSent(review: MlReview, messageId?: string): Promise<DeliveryState> {
	await collections.mlReviews.updateOne(held(review), {
		$set: {
			"delivery.status": "sent",
			...(messageId ? { "delivery.messageId": messageId } : {}),
			updatedAt: new Date(),
		},
		$unset: { "delivery.error": "" },
	});
	return "sent";
}

async function release(
	review: MlReview,
	{ error, counted }: { error?: string; counted: boolean }
): Promise<DeliveryState> {
	const attempts = review.delivery?.attempts ?? 1;
	const failed = counted && attempts >= MAX_ATTEMPTS;
	await collections.mlReviews.updateOne(held(review), {
		$set: {
			"delivery.status": failed ? "failed" : "pending",
			...(error ? { "delivery.error": error } : {}),
			updatedAt: new Date(),
		},
		...(counted ? {} : { $inc: { "delivery.attempts": -1 } }),
	});
	if (failed) logger.error({ reviewId: review._id.toString(), error }, "[review] delivery gave up");
	return failed ? "failed" : "queued";
}

async function drain(response: Response): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) return;
	try {
		while (!(await reader.read()).done) {
			// the run persists itself, reading only keeps it flowing
		}
	} finally {
		reader.releaseLock();
	}
}

const reasonOf = (err: unknown): string => {
	const body = (err as { body?: { message?: unknown } } | null)?.body;
	if (typeof body?.message === "string") return body.message;
	return err instanceof Error ? err.message : String(err);
};

/** posts a detached submission as the next user message once, deferring while a turn runs */
export async function deliverReview(
	reviewId: ObjectId,
	selection?: AskResumeSelection
): Promise<DeliveryState> {
	const review = await claim(reviewId);
	if (!review) return stateOf(await collections.mlReviews.findOne({ _id: reviewId }));
	const text = review.result?.text;
	if (!text) return release(review, { error: "the submission has no result yet", counted: true });

	const conv = await collections.conversations.findOne({ _id: review.conversationId });
	if (!conv) return release(review, { error: "the conversation is gone", counted: true });
	const posted = conv.messages.findLast((m) => m.from === "user" && m.content === text);
	if (posted) return markSent(review, posted.id);
	const running = await collections.generations.countDocuments({
		conversationId: conv._id,
		status: "running",
	});
	if (running > 0) return release(review, { counted: false });

	try {
		const { locals } = await rebuildIdentity({
			...(conv.userId ? { userId: conv.userId } : {}),
			...(conv.sessionId ? { sessionId: conv.sessionId } : {}),
		});
		if (selection?.selectedServerNames || selection?.selectedServers) {
			(locals as unknown as Record<string, unknown>).mcp = {
				selectedServerNames: selection.selectedServerNames,
				selectedServers: selection.selectedServers ?? [],
			};
		}
		if (selection?.timezone) {
			(locals as unknown as Record<string, unknown>).timezone = selection.timezone;
		}
		const data = new FormData();
		data.set(
			"data",
			JSON.stringify({
				inputs: text,
				id: conv.messages.at(-1)?.id ?? conv.rootMessageId,
				generationId: randomUUID(),
			})
		);
		const { generateConversationResponse } =
			await import("$lib/server/generation/conversationRequest");
		const response = await generateConversationResponse({
			request: new Request("http://review.internal/conversation", { method: "POST", body: data }),
			locals,
			params: { id: conv._id.toString() },
			getClientAddress: () => "review-delivery",
		});
		if (!response.ok) throw new Error(`the conversation route answered ${response.status}`);
		// the route saved the message before it answered, so this finds it
		const saved = await collections.conversations.findOne(
			{ _id: conv._id },
			{ projection: { messages: 1 } }
		);
		const message = saved?.messages.findLast((m) => m.from === "user" && m.content === text);
		const state = await markSent(review, message?.id);
		drain(response).catch((err) =>
			logger.error({ err, reviewId: review._id.toString() }, "[review] delivered turn failed")
		);
		return state;
	} catch (err) {
		logger.warn({ err, reviewId: review._id.toString() }, "[review] delivery attempt failed");
		return release(review, { error: reasonOf(err), counted: true });
	}
}

/** deliveries whose attempt was deferred or whose process died, oldest first */
export async function sweepReviewDeliveries(): Promise<void> {
	const now = Date.now();
	const due = await collections.mlReviews
		.find(
			{
				$or: [
					{ "delivery.status": "pending" },
					{
						"delivery.status": "sending",
						"delivery.takenAt": { $lt: new Date(now - DELIVERY_LEASE_MS) },
					},
				],
			},
			{ projection: { _id: 1 } }
		)
		.sort({ "delivery.takenAt": 1 })
		.limit(SWEEP_BATCH)
		.toArray();
	for (const { _id } of due) await deliverReview(_id);
}
