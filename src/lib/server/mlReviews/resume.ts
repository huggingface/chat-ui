import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { AskResumeSelection } from "$lib/server/generation/askResume";
import { turnAwaitingInput } from "$lib/server/generation/turnState";
import { REQUEST_REVIEW_TOOL_NAME } from "$lib/server/textGeneration/builtinTools/requestReviewDefinition";
import type { McpElicitation, PendingAskCall, PendingReviewCall } from "$lib/types/McpElicitation";
import type { MlReview } from "$lib/types/MlReview";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { deliverReview } from "./delivery";
import { sameDestination } from "./destination";
import { chosenDecision, decidePublish, openPublishPrompt } from "./publish";
import { ensureReviewResult, reviewResolvedUpdate } from "./result";
import { readReview, releaseHeldDelivery } from "./store";

const MISSING = "The review's submission could not be found. Ask the user what they decided.";

export const reviewToolResult = (toolUuid: string, text: string): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid: toolUuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name: REQUEST_REVIEW_TOOL_NAME, parameters: {} },
		outputs: [{ text }] as unknown as Record<string, unknown>[],
		display: true,
	},
});

const awaitingPublish = (review: MlReview) =>
	review.status === "submitted" &&
	!!review.destination &&
	!review.publish?.decision &&
	!review.result;

/** a live run parks on the publish card, with no run to park nothing is pushed, review resolved goes before the marker */
export async function reviewResumeUpdates({
	conversationId,
	pending,
	settled,
	generationId,
	mayPark,
}: {
	conversationId: ObjectId;
	pending: PendingReviewCall;
	settled: MessageUpdate;
	generationId?: string;
	mayPark?: boolean;
}): Promise<{ updates: MessageUpdate[]; parkedAgain?: boolean }> {
	let review = await readReview(conversationId, pending.reviewId);
	if (review && awaitingPublish(review)) {
		if (mayPark && generationId) {
			const opened = await openPublishPrompt({
				review,
				messageId: pending.messageId,
				toolCallId: pending.toolCallId,
				toolUuid: pending.toolUuid,
				generationId,
			});
			if ("update" in opened) {
				const waiting = await turnAwaitingInput({
					conversationId,
					messageId: pending.messageId,
					producerId: generationId,
				});
				return {
					updates: [reviewResolvedUpdate(review), settled, opened.update, waiting],
					parkedAgain: true,
				};
			}
			review = opened.decided;
		} else {
			review = await decidePublish(review, "skip", "the user wrote before confirming the push");
		}
	}
	const submitted =
		review?.status === "submitted"
			? { ...review, result: await ensureReviewResult(review) }
			: undefined;
	return {
		updates: [
			...(submitted ? [reviewResolvedUpdate(submitted)] : []),
			settled,
			reviewToolResult(pending.toolUuid, submitted?.result?.text ?? MISSING),
		],
	};
}

/** push, open a pull request or skip, then the review result the call waited for */
export async function publishAnswerUpdates({
	conversationId,
	row,
	pending,
	settled,
}: {
	conversationId: ObjectId;
	row: McpElicitation;
	pending: PendingAskCall & { publish: NonNullable<PendingAskCall["publish"]> };
	settled: MessageUpdate;
}): Promise<{ updates: MessageUpdate[] }> {
	const { publish } = pending;
	const review = await readReview(conversationId, publish.reviewId);
	if (!review) {
		return {
			updates: publish.deliver ? [settled] : [settled, reviewToolResult(pending.toolUuid, MISSING)],
		};
	}
	const decision = chosenDecision(row.action, row.content);
	// the card names one destination, an answer pushes only to that one
	const same = !!review.destination && sameDestination(review.destination, publish.destination);
	const reason = !same
		? "the destination changed after the publish card was shown"
		: decision === "skip"
			? row.action === "accept"
				? "the user chose not to push"
				: "the publish card was closed without a choice"
			: undefined;
	const decided = await decidePublish(review, same ? decision : "skip", reason);
	const result = await ensureReviewResult(decided);
	const resolved = reviewResolvedUpdate({ ...decided, result });
	if (publish.deliver) {
		await releaseHeldDelivery(review);
		deliverReview(review._id).catch((err) =>
			logger.error({ err, reviewId: publish.reviewId }, "[review] delivery after publish failed")
		);
		return { updates: [resolved, settled] };
	}
	return { updates: [resolved, settled, reviewToolResult(pending.toolUuid, result.text)] };
}

/** no parked call to resume, the card goes on the review message and the held delivery posts after it */
export async function openDetachedPublish(
	review: MlReview,
	selection?: AskResumeSelection
): Promise<string | undefined> {
	const opened = await openPublishPrompt({
		review,
		messageId: review.messageId,
		toolCallId: review.toolCallId,
		toolUuid: review.toolUuid,
		deliver: true,
	});
	if ("decided" in opened) {
		await releaseHeldDelivery(review);
		deliverReview(review._id, selection).catch((err) =>
			logger.error({ err, reviewId: review._id.toString() }, "[review] delivery failed")
		);
		return undefined;
	}
	const now = new Date();
	await collections.conversations.updateOne(
		{ _id: review.conversationId, "messages.id": review.messageId },
		{
			$push: { "messages.$.updates": opened.update },
			$set: { "messages.$.updatedAt": now, updatedAt: now },
		} as never
	);
	return opened.elicitationId;
}
