import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";
import type { AskResumeSelection } from "$lib/server/generation/askResume";
import type { MlReview } from "$lib/types/MlReview";
import type { Message } from "$lib/types/Message";
import { acquireLock, releaseLock } from "$lib/migrations/lock";

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

/** the route registers its generation inside its stream, a few database writes after it answers */
const REGISTER_WAIT_MS = 10_000;
const REGISTER_POLL_MS = 100;

async function registered(generationId: string): Promise<boolean> {
	const deadline = Date.now() + REGISTER_WAIT_MS;
	for (;;) {
		if (await collections.generations.countDocuments({ generationId })) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, REGISTER_POLL_MS));
	}
}

/** a run posted by an earlier attempt exists, so the review is in the conversation for good */
async function ranFrom(
	conversationId: ObjectId,
	posted: Message,
	generationId: string | undefined
): Promise<boolean> {
	const runs = await collections.generations.countDocuments({
		conversationId,
		$or: [
			...(generationId ? [{ generationId }] : []),
			{ messageId: { $in: posted.children ?? [] } },
		],
	});
	return runs > 0;
}

/** posts a detached submission once per conversation lock, and reruns a post whose run never began */
export async function deliverReview(
	reviewId: ObjectId,
	selection?: AskResumeSelection
): Promise<DeliveryState> {
	const review = await claim(reviewId);
	if (!review) return stateOf(await collections.mlReviews.findOne({ _id: reviewId }));
	const text = review.result?.text;
	if (!text) return release(review, { error: "the submission has no result yet", counted: true });

	// the route rewrites the whole message array, so two posts at once would drop one
	const lockKey = `review.delivery:${review.conversationId.toString()}`;
	const lock = await acquireLock(lockKey);
	if (!lock) return release(review, { counted: false });
	try {
		const conv = await collections.conversations.findOne({ _id: review.conversationId });
		if (!conv) return release(review, { error: "the conversation is gone", counted: true });
		const running = await collections.generations.countDocuments({
			conversationId: conv._id,
			status: "running",
		});
		if (running > 0) return release(review, { counted: false });

		const posted = conv.messages.findLast((m) => m.from === "user" && m.content === text);
		if (posted && (await ranFrom(conv._id, posted, review.delivery?.generationId))) {
			return markSent(review, posted.id);
		}
		const reply = posted
			? conv.messages.find((m) => m.from === "assistant" && posted.children?.includes(m.id))
			: undefined;
		if (posted && !reply) {
			return release(review, { error: "the posted message has no reply to run", counted: true });
		}

		const generationId = randomUUID();
		await collections.mlReviews.updateOne(held(review), {
			$set: { "delivery.generationId": generationId },
		});
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
			JSON.stringify(
				reply
					? { id: reply.id, is_retry: true, generationId }
					: {
							inputs: text,
							id: conv.messages.at(-1)?.id ?? conv.rootMessageId,
							generationId,
						}
			)
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
		drain(response).catch((err) =>
			logger.error({ err, reviewId: review._id.toString() }, "[review] delivered turn failed")
		);
		// sent only once the run exists, a crash before that leaves the lease to lapse into a rerun
		if (!(await registered(generationId))) {
			return release(review, { error: "the run was not registered in time", counted: true });
		}
		const saved = await collections.conversations.findOne(
			{ _id: conv._id },
			{ projection: { messages: 1 } }
		);
		const message = saved?.messages.findLast((m) => m.from === "user" && m.content === text);
		return markSent(review, message?.id);
	} catch (err) {
		logger.warn({ err, reviewId: review._id.toString() }, "[review] delivery attempt failed");
		return release(review, { error: reasonOf(err), counted: true });
	} finally {
		await releaseLock(lockKey, lock).catch(() => undefined);
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
