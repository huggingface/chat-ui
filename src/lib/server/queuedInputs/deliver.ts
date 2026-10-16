import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { MessageUpdateType, type MessageQueuedInputUpdate } from "$lib/types/MessageUpdate";
import type { QueuedInput } from "$lib/types/QueuedInput";
import { claimQueuedInputs } from "./store";

const QUEUED_INPUT_HEADER =
	"[The user sent this while you were working. It is not part of the tool result. " +
	"Take it into account before your next step: it may add to, change or cancel what you are doing.]";

export function queuedInputText(rows: Pick<QueuedInput, "text">[]): string {
	return [
		QUEUED_INPUT_HEADER,
		...rows.map((row) => `<user_message>\n${row.text}\n</user_message>`),
	].join("\n");
}

export function queuedInputUpdate(
	rows: QueuedInput[],
	afterToolUuid: string
): MessageQueuedInputUpdate {
	return {
		type: MessageUpdateType.QueuedInput,
		inputs: rows.map((row) => ({
			id: row._id.toString(),
			text: row.text,
			at: row.createdAt.getTime(),
		})),
		text: queuedInputText(rows),
		afterToolUuid,
	};
}

// claimed before emitting so a losing cancel reports sent, a pod death before materialise loses it
export async function takeQueuedInputs(
	conversationId: ObjectId,
	messageId: string,
	afterToolUuid: string
): Promise<MessageQueuedInputUpdate | undefined> {
	try {
		const rows = await claimQueuedInputs(conversationId, { status: "delivered", messageId });
		if (rows.length === 0) return undefined;
		logger.info(
			{ conversationId: conversationId.toString(), messageId, count: rows.length },
			"[queuedInputs] delivered into a busy turn"
		);
		return queuedInputUpdate(rows, afterToolUuid);
	} catch (err) {
		logger.error(
			{ err, conversationId: conversationId.toString() },
			"[queuedInputs] could not take queued messages, they stay queued"
		);
		return undefined;
	}
}

// the parking run saves every message only when it ends, a resume before that save is overwritten
const PARKED_SAVE_GRACE_MS = 15_000;

/** true when there was a wait to wake */
export async function wakeParkForQueuedInput(conversationId: ObjectId): Promise<boolean> {
	const now = new Date();
	const wakeAt = { $max: [now, { $add: ["$createdAt", PARKED_SAVE_GRACE_MS] }] };
	const early = { $gt: ["$resumeAt", wakeAt] };
	const result = await collections.parkedCalls.updateOne(
		{ conversationId, kind: "timer", status: "waiting" },
		[
			{
				$set: {
					plannedResumeAt: {
						$cond: [early, { $ifNull: ["$plannedResumeAt", "$resumeAt"] }, "$plannedResumeAt"],
					},
					wokeByUserMessageAt: { $cond: [early, now, "$wokeByUserMessageAt"] },
					resumeAt: { $min: ["$resumeAt", wakeAt] },
					updatedAt: now,
				},
			},
		]
	);
	return result.matchedCount > 0;
}
