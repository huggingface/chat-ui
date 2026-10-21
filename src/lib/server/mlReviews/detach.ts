import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { turnAnsweredWithoutRun } from "$lib/server/generation/turnState";
import { REQUEST_REVIEW_TOOL_NAME } from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";
import type { Conversation } from "$lib/types/Conversation";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { deliverReview } from "./delivery";
import { decidePublish } from "./publish";
import { ensureReviewResult, reviewCounts, reviewResolvedUpdate } from "./result";
import { reviewToolResult } from "./resume";
import { detachReview, readReview, releaseHeldDelivery } from "./store";

export const USER_WROTE_INSTEAD = "user wrote instead";

const hasResult = (updates: Conversation["messages"][number]["updates"], toolUuid: string) =>
	(updates ?? []).some(
		(update) =>
			update.type === MessageUpdateType.Tool &&
			(update.subtype === MessageToolUpdateType.Result ||
				update.subtype === MessageToolUpdateType.Error) &&
			update.uuid === toolUuid
	);

/** closes waiting reviews as still open, the returned call detaches them after the save */
export async function detachOpenReviews(
	conv: Pick<Conversation, "_id" | "messages">
): Promise<() => Promise<void>> {
	const rows = await collections.mcpElicitations
		.find({ conversationId: conv._id, status: "pending", "pending.kind": "review" })
		.toArray();

	const withdrawn: string[] = [];
	for (const row of rows) {
		const pending = row.pending;
		if (pending?.kind !== "review") continue;
		const message = conv.messages.find((m) => m.id === pending.messageId);
		if (message && hasResult(message.updates, pending.toolUuid)) continue;

		// abandoned too, otherwise answeredByUser lets a later answer replace a withdrawn close
		const now = new Date();
		const closed = await collections.mcpElicitations.updateOne(
			{ _id: row._id, status: "pending" },
			{
				$set: {
					status: "resolved",
					action: "cancel",
					resolution: "withdrawn",
					resolvedAt: now,
					updatedAt: now,
					resume: {
						status: "abandoned",
						takenAt: now,
						attempts: 0,
						abandonedReason: USER_WROTE_INSTEAD,
					},
				},
			}
		);
		// a submit that resolved it meanwhile delivers itself as a message
		if (closed.matchedCount === 0) continue;
		withdrawn.push(pending.reviewId);
		if (!message || message.from !== "assistant") continue;

		const review = await readReview(conv._id, pending.reviewId);
		const counts = review ? reviewCounts(review) : undefined;
		const title = review?.schema.title ?? row.request.message;
		const progress = counts
			? `${counts.answered} of ${counts.total} answered, ${counts.comments} comment${counts.comments === 1 ? "" : "s"}`
			: "no answers recorded";
		const ended = await turnAnsweredWithoutRun(conv._id, message.id);
		message.updates = [
			...(message.updates ?? []),
			{
				type: MessageUpdateType.Elicitation,
				subtype: MessageElicitationUpdateType.Resolved,
				elicitationId: row.elicitationId,
				action: "cancel",
				resolution: "withdrawn",
			},
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Result,
				uuid: pending.toolUuid,
				result: {
					status: ToolResultStatus.Success,
					call: { name: REQUEST_REVIEW_TOOL_NAME, parameters: {} },
					outputs: [
						{
							text: `Review "${title}" is still open: ${progress}. The user wrote instead; the review stays open and its submission will arrive as a user message.`,
						},
					] as unknown as Record<string, unknown>[],
					display: true,
				},
			},
			...(ended ? [ended] : []),
		];
		message.updatedAt = new Date();
	}

	await closePublishPrompts(conv);

	return async () => {
		for (const reviewId of withdrawn) {
			await detachReview(conv._id, reviewId).catch((err) =>
				logger.error({ err, reviewId }, "[review] failed to detach a review")
			);
		}
	};
}

/** a publish card the user wrote past is not pushed, a detached review posts its held message */
async function closePublishPrompts(conv: Pick<Conversation, "_id" | "messages">): Promise<void> {
	const rows = await collections.mcpElicitations
		.find({
			conversationId: conv._id,
			status: "pending",
			"pending.kind": "ask",
			"pending.publish": { $exists: true },
		})
		.toArray();
	for (const row of rows) {
		const pending = row.pending;
		if (pending?.kind !== "ask" || !pending.publish) continue;
		const now = new Date();
		const closed = await collections.mcpElicitations.updateOne(
			{ _id: row._id, status: "pending" },
			{
				$set: {
					status: "resolved",
					action: "cancel",
					resolution: "withdrawn",
					resolvedAt: now,
					updatedAt: now,
					resume: {
						status: "abandoned",
						takenAt: now,
						attempts: 0,
						abandonedReason: USER_WROTE_INSTEAD,
					},
				},
			}
		);
		if (closed.matchedCount === 0) continue;
		const review = await readReview(conv._id, pending.publish.reviewId);
		if (!review) continue;
		const decided = await decidePublish(
			review,
			"skip",
			"the user wrote instead of answering the publish card"
		);
		const result = await ensureReviewResult(decided);
		if (pending.publish.deliver) {
			await releaseHeldDelivery(review);
			deliverReview(review._id).catch((err) =>
				logger.error({ err, reviewId: pending.publish?.reviewId }, "[review] delivery failed")
			);
			continue;
		}
		const message = conv.messages.find((m) => m.id === pending.messageId);
		if (!message || message.from !== "assistant") continue;
		if (hasResult(message.updates, pending.toolUuid)) continue;
		const ended = await turnAnsweredWithoutRun(conv._id, message.id);
		message.updates = [
			...(message.updates ?? []),
			reviewResolvedUpdate({ ...decided, result }),
			{
				type: MessageUpdateType.Elicitation,
				subtype: MessageElicitationUpdateType.Resolved,
				elicitationId: row.elicitationId,
				action: "cancel",
				resolution: "withdrawn",
			},
			reviewToolResult(pending.toolUuid, result.text),
			...(ended ? [ended] : []),
		];
		message.updatedAt = new Date();
	}
}
