import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { usageLimits } from "$lib/server/usageLimits";
import type { QueuedInput, QueuedInputView } from "$lib/types/QueuedInput";

export const MAX_QUEUED_INPUTS = 10;
const MAX_QUEUED_INPUT_CHARS = 32_000;
const JOIN = "\n\n";

/** one message and the batch a turn takes at once, a started turn must pass the message limit */
export function queuedInputCharLimit(): number {
	return Math.min(MAX_QUEUED_INPUT_CHARS, usageLimits?.messageLength ?? Infinity);
}

export class QueueFullError extends Error {}
export class QueuedInputTooLongError extends Error {}

export async function enqueueInput(input: {
	conversationId: ObjectId;
	text: string;
	source: QueuedInput["source"];
	userId?: QueuedInput["userId"];
	sessionId?: string;
}): Promise<QueuedInput> {
	const text = input.text.replace(/\r\n/g, "\n");
	if (text.length > queuedInputCharLimit()) {
		throw new QueuedInputTooLongError("This message is too long to queue.");
	}
	const now = new Date();
	const row: QueuedInput = {
		_id: new ObjectId(),
		conversationId: input.conversationId,
		text,
		status: "queued",
		source: input.source,
		...(input.userId ? { userId: input.userId } : {}),
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
		createdAt: now,
		updatedAt: now,
	};
	await collections.queuedInputs.insertOne(row);
	// counted after the insert, so two racing sends cannot both pass a full queue
	const waiting = await collections.queuedInputs.countDocuments({
		conversationId: input.conversationId,
		status: "queued",
	});
	if (waiting > MAX_QUEUED_INPUTS) {
		await collections.queuedInputs.deleteOne({ _id: row._id, status: "queued" });
		throw new QueueFullError("Too many queued messages.");
	}
	return row;
}

/** false when a turn already took it, a failed row is acknowledged by whoever cancels it first */
export async function cancelQueuedInput(conversationId: ObjectId, id: ObjectId): Promise<boolean> {
	const result = await collections.queuedInputs.updateOne(
		{ _id: id, conversationId, status: { $in: ["queued", "failed"] } },
		{ $set: { status: "cancelled", updatedAt: new Date() } }
	);
	return result.matchedCount > 0;
}

/** the ids it cancelled, a row a turn took first is not among them */
export async function cancelAllQueuedInputs(conversationId: ObjectId): Promise<string[]> {
	const cancelled: string[] = [];
	for (let i = 0; i < MAX_QUEUED_INPUTS * 2; i += 1) {
		const result = await collections.queuedInputs.findOneAndUpdate(
			{ conversationId, status: "queued" },
			{ $set: { status: "cancelled", updatedAt: new Date() } },
			{ sort: { createdAt: 1 } }
		);
		if (!result.value) break;
		cancelled.push(result.value._id.toString());
	}
	return cancelled;
}

export async function hasQueuedInputs(conversationId: ObjectId): Promise<boolean> {
	return (
		(await collections.queuedInputs.countDocuments(
			{ conversationId, status: "queued" },
			{ limit: 1 }
		)) > 0
	);
}

/** oldest first, one CAS per row, stops before the joined text passes the char limit */
export async function claimQueuedInputs(
	conversationId: ObjectId,
	as: { status: "delivered"; messageId: string } | { status: "started" }
): Promise<QueuedInput[]> {
	const claimToken = randomUUID();
	const budget = queuedInputCharLimit();
	const claimed: QueuedInput[] = [];
	let chars = 0;
	try {
		await claimInto(claimed);
	} catch (err) {
		await requeue(claimed).catch(() => {});
		throw err;
	}
	return claimed;

	async function claimInto(rows: QueuedInput[]) {
		for (let i = 0; i < MAX_QUEUED_INPUTS * 2; i += 1) {
			const next = await collections.queuedInputs.findOne(
				{ conversationId, status: "queued" },
				{ sort: { createdAt: 1 }, projection: { _id: 1, text: 1 } }
			);
			if (!next) return;
			const joined = chars + (rows.length > 0 ? JOIN.length : 0) + next.text.length;
			if (rows.length > 0 && joined > budget) return;
			const now = new Date();
			const result = await collections.queuedInputs.findOneAndUpdate(
				{ _id: next._id, status: "queued" },
				{
					$set: {
						status: as.status,
						claimToken,
						takenAt: now,
						updatedAt: now,
						...(as.status === "delivered" ? { messageId: as.messageId } : {}),
					},
				},
				{ returnDocument: "after" }
			);
			if (!result.value) continue;
			rows.push(result.value);
			chars = joined;
		}
	}
}

async function requeue(rows: QueuedInput[]): Promise<void> {
	if (rows.length === 0) return;
	await collections.queuedInputs.updateMany(
		{ _id: { $in: rows.map((row) => row._id) }, claimToken: rows[0].claimToken },
		{
			$set: { status: "queued", updatedAt: new Date() },
			$unset: { claimToken: "", takenAt: "", messageId: "" },
		}
	);
}

/** a started turn is running, its rows no longer need the recovery sweep */
export async function ackQueuedInputs(rows: QueuedInput[]): Promise<void> {
	if (rows.length === 0) return;
	await collections.queuedInputs.updateMany(
		{ _id: { $in: rows.map((row) => row._id) } },
		{ $set: { ackedAt: new Date() } }
	);
}

const CLAIM_LEASE_MS = 2 * 60_000;

/** requeues a claim not acknowledged within the lease unless the conversation shows it arrived */
export async function recoverStaleClaims(now = new Date()): Promise<number> {
	const stale = await collections.queuedInputs
		.find({
			status: { $in: ["delivered", "started"] },
			ackedAt: { $exists: false },
			takenAt: { $lt: new Date(now.getTime() - CLAIM_LEASE_MS) },
		})
		.limit(50)
		.toArray();
	let requeued = 0;
	for (const row of stale) {
		if (await arrived(row)) {
			await collections.queuedInputs.updateOne({ _id: row._id }, { $set: { ackedAt: now } });
			continue;
		}
		const result = await collections.queuedInputs.updateOne(
			{ _id: row._id, claimToken: row.claimToken, ackedAt: { $exists: false } },
			{
				$set: { status: "queued", updatedAt: now },
				$unset: { claimToken: "", takenAt: "", messageId: "" },
			}
		);
		requeued += result.modifiedCount;
	}
	return requeued;
}

async function arrived(row: QueuedInput): Promise<boolean> {
	const id = row._id.toString();
	if (row.status === "delivered") {
		const logged = await collections.generationEvents.findOne(
			{
				conversationId: row.conversationId,
				messageId: row.messageId,
				"event.type": "queuedInput",
				"event.inputs.id": id,
			},
			{ projection: { _id: 1 } }
		);
		if (logged) return true;
		const stored = await collections.conversations.findOne(
			{
				_id: row.conversationId,
				messages: { $elemMatch: { id: row.messageId, "updates.inputs.id": id } },
			},
			{ projection: { _id: 1 } }
		);
		return stored !== null;
	}
	const conversation = await collections.conversations.findOne(
		{ _id: row.conversationId },
		{
			projection: {
				messages: {
					$filter: {
						input: "$messages",
						cond: {
							$and: [{ $eq: ["$$this.from", "user"] }, { $gte: ["$$this.createdAt", row.takenAt] }],
						},
					},
				},
			},
		}
	);
	return (conversation?.messages ?? []).some((message) => message.content.includes(row.text));
}

export function joinQueuedInputs(rows: Pick<QueuedInput, "text">[]): string {
	return rows.map((row) => row.text).join(JOIN);
}

const MAX_START_ATTEMPTS = 3;

/** a started turn that never ran puts its messages back, they were not read */
export async function releaseQueuedInputs(rows: QueuedInput[], reason: string): Promise<void> {
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
	// a refusal that repeats would start forever, failed rows go back to the composer
	await failQueuedInputs(
		{ _id: { $in: ids }, status: "queued", attempts: { $gte: MAX_START_ATTEMPTS } },
		reason
	);
}

export async function failQueuedInputs(
	filter: Parameters<typeof collections.queuedInputs.updateMany>[0],
	reason: string
): Promise<void> {
	const now = new Date();
	await collections.queuedInputs.updateMany(filter, {
		$set: { status: "failed", error: reason, takenAt: now, updatedAt: now },
	});
}

const RECENT_MS = 10 * 60_000;

/** also what a turn took lately, so the browser can tell where it went */
export async function listQueuedInputs(conversationId: ObjectId): Promise<QueuedInputView[]> {
	const [queued, taken] = await Promise.all([
		collections.queuedInputs
			.find({ conversationId, status: "queued" })
			.sort({ createdAt: 1 })
			.limit(MAX_QUEUED_INPUTS * 2)
			.toArray(),
		collections.queuedInputs
			.find({
				conversationId,
				$or: [
					{ status: "failed" },
					{
						status: { $in: ["delivered", "started"] },
						takenAt: { $gte: new Date(Date.now() - RECENT_MS) },
					},
				],
			})
			.sort({ takenAt: -1 })
			.limit(MAX_QUEUED_INPUTS * 2)
			.toArray(),
	]);
	return [...taken.reverse(), ...queued].map(queuedInputView);
}

export function queuedInputView(row: QueuedInput): QueuedInputView {
	return {
		id: row._id.toString(),
		text: row.text,
		status: row.status,
		createdAt: row.createdAt.getTime(),
		...(row.error ? { error: row.error } : {}),
	};
}
