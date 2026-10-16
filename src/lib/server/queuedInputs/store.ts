import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { QueuedInput, QueuedInputView } from "$lib/types/QueuedInput";

export const MAX_QUEUED_INPUTS = 10;
export const MAX_QUEUED_INPUT_CHARS = 32_000;

export class QueueFullError extends Error {}

export async function enqueueInput(input: {
	conversationId: ObjectId;
	text: string;
	source: QueuedInput["source"];
	userId?: QueuedInput["userId"];
	sessionId?: string;
}): Promise<QueuedInput> {
	const waiting = await collections.queuedInputs.countDocuments({
		conversationId: input.conversationId,
		status: "queued",
	});
	if (waiting >= MAX_QUEUED_INPUTS) throw new QueueFullError("Too many queued messages.");
	const now = new Date();
	const row: QueuedInput = {
		_id: new ObjectId(),
		conversationId: input.conversationId,
		text: input.text.replace(/\r\n/g, "\n"),
		status: "queued",
		source: input.source,
		...(input.userId ? { userId: input.userId } : {}),
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
		createdAt: now,
		updatedAt: now,
	};
	await collections.queuedInputs.insertOne(row);
	return row;
}

/** false when a turn already took it */
export async function cancelQueuedInput(conversationId: ObjectId, id: ObjectId): Promise<boolean> {
	const result = await collections.queuedInputs.updateOne(
		{ _id: id, conversationId, status: "queued" },
		{ $set: { status: "cancelled", updatedAt: new Date() } }
	);
	return result.matchedCount > 0;
}

export async function cancelAllQueuedInputs(conversationId: ObjectId): Promise<void> {
	await collections.queuedInputs.updateMany(
		{ conversationId, status: "queued" },
		{ $set: { status: "cancelled", updatedAt: new Date() } }
	);
}

export async function hasQueuedInputs(conversationId: ObjectId): Promise<boolean> {
	return (
		(await collections.queuedInputs.countDocuments(
			{ conversationId, status: "queued" },
			{ limit: 1 }
		)) > 0
	);
}

// each row is its own CAS out of queued, so a cancel wins or loses whole and takers never share
export async function claimQueuedInputs(
	conversationId: ObjectId,
	as: { status: "delivered"; messageId: string } | { status: "started" }
): Promise<QueuedInput[]> {
	const claimToken = randomUUID();
	const claimed: QueuedInput[] = [];
	for (let i = 0; i < MAX_QUEUED_INPUTS * 2; i += 1) {
		const now = new Date();
		const result = await collections.queuedInputs.findOneAndUpdate(
			{ conversationId, status: "queued" },
			{
				$set: {
					status: as.status,
					claimToken,
					takenAt: now,
					updatedAt: now,
					...(as.status === "delivered" ? { messageId: as.messageId } : {}),
				},
			},
			{ sort: { createdAt: 1 }, returnDocument: "after" }
		);
		if (!result.value) break;
		claimed.push(result.value);
	}
	return claimed;
}

const MAX_START_ATTEMPTS = 3;

/** a started turn that never ran puts its messages back, they were not read */
export async function releaseQueuedInputs(rows: QueuedInput[]): Promise<void> {
	if (rows.length === 0) return;
	const now = new Date();
	const ids = rows.map((row) => row._id);
	await collections.queuedInputs.updateMany(
		{ _id: { $in: ids }, claimToken: rows[0].claimToken },
		{
			$set: { status: "queued", updatedAt: now },
			$unset: { claimToken: "", takenAt: "" },
			$inc: { attempts: 1 },
		}
	);
	// a refusal that repeats, a gone user or a rate limit that never lifts, would start forever
	await collections.queuedInputs.updateMany(
		{ _id: { $in: ids }, status: "queued", attempts: { $gte: MAX_START_ATTEMPTS } },
		{ $set: { status: "cancelled", updatedAt: now } }
	);
}

const RECENT_MS = 10 * 60_000;

/** also what a turn took lately, so the browser can tell where it went */
export async function listQueuedInputs(conversationId: ObjectId): Promise<QueuedInputView[]> {
	const rows = await collections.queuedInputs
		.find({
			conversationId,
			$or: [
				{ status: "queued" },
				{
					status: { $in: ["delivered", "started"] },
					takenAt: { $gte: new Date(Date.now() - RECENT_MS) },
				},
			],
		})
		.sort({ createdAt: 1 })
		.limit(MAX_QUEUED_INPUTS * 3)
		.toArray();
	return rows.map(queuedInputView);
}

export function queuedInputView(row: QueuedInput): QueuedInputView {
	return {
		id: row._id.toString(),
		text: row.text,
		status: row.status,
		createdAt: row.createdAt.getTime(),
	};
}
