import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";

/**
 * Budget state transitions. Every write is a single guarded updateOne so that
 * concurrent tool calls, retried rounds and parallel settles cannot
 * double-reserve, double-settle or race a check against a stale read.
 */

export type ReserveOutcome =
	| { outcome: "reserved"; budget: MlBudget }
	/** The key already holds a reservation — this exact dispatch was already paid for. */
	| { outcome: "already_reserved"; budget: MlBudget }
	| { outcome: "insufficient"; budget: MlBudget }
	/** The conversation carries no budget; the caller should not have gated this call. */
	| { outcome: "no_budget" };

export async function reserveMlBudget({
	conversationId,
	reservation,
}: {
	conversationId: ObjectId;
	reservation: MlBudgetReservation;
}): Promise<ReserveOutcome> {
	const res = await collections.conversations.updateOne(
		{
			_id: conversationId,
			// $expr treats a missing budget as null and null <= null holds, so
			// without this type guard a budget-less conversation would match and
			// $push would conjure a half-formed mlBudget.
			"mlBudget.totalMicroUsd": { $type: "number" },
			"mlBudget.reservations.key": { $ne: reservation.key },
			$expr: {
				$lte: [
					{
						$add: [
							reservation.ceilingMicroUsd,
							{ $ifNull: ["$mlBudget.spentMicroUsd", 0] },
							{ $sum: { $ifNull: ["$mlBudget.reservations.ceilingMicroUsd", []] } },
						],
					},
					"$mlBudget.totalMicroUsd",
				],
			},
		},
		{ $push: { "mlBudget.reservations": reservation } }
	);
	const budget = await readMlBudget(conversationId);
	if (!budget) return { outcome: "no_budget" };
	if (res.modifiedCount > 0) return { outcome: "reserved", budget };
	if (budget.reservations.some((r) => r.key === reservation.key)) {
		return { outcome: "already_reserved", budget };
	}
	return { outcome: "insufficient", budget };
}

/** Record which job a reservation paid for, so settle can find it later. */
export async function attachJobToReservation({
	conversationId,
	key,
	jobId,
	namespace,
}: {
	conversationId: ObjectId;
	key: string;
	jobId: string;
	namespace?: string;
}): Promise<void> {
	await collections.conversations.updateOne(
		{ _id: conversationId, "mlBudget.reservations.key": key },
		{
			$set: {
				"mlBudget.reservations.$.jobId": jobId,
				...(namespace ? { "mlBudget.reservations.$.namespace": namespace } : {}),
			},
		}
	);
}

/**
 * Refund a reservation whose submission verifiably did not run — the server
 * answered with an error before launching anything. Refuses to touch a
 * reservation with a job attached: that money is spoken for until settle.
 */
export async function releaseReservation({
	conversationId,
	key,
}: {
	conversationId: ObjectId;
	key: string;
}): Promise<boolean> {
	const res = await collections.conversations.updateOne(
		{
			_id: conversationId,
			"mlBudget.reservations": { $elemMatch: { key, jobId: { $exists: false } } },
		},
		{ $pull: { "mlBudget.reservations": { key, jobId: { $exists: false } } } }
	);
	return res.modifiedCount > 0;
}

/**
 * Close a reservation at its actual cost: drop the hold and add the actual to
 * spent in one write. The $elemMatch filter makes a second settle of the same
 * key match nothing, so a refund cannot be paid twice.
 */
export async function settleReservation({
	conversationId,
	key,
	actualMicroUsd,
}: {
	conversationId: ObjectId;
	key: string;
	actualMicroUsd: number;
}): Promise<boolean> {
	const res = await collections.conversations.updateOne(
		{ _id: conversationId, "mlBudget.reservations": { $elemMatch: { key } } },
		{
			$pull: { "mlBudget.reservations": { key } },
			$inc: { "mlBudget.spentMicroUsd": actualMicroUsd },
		}
	);
	return res.modifiedCount > 0;
}

/**
 * Set (or create) the budget total without touching spend or open holds.
 * Lowering below what is already spent or held is allowed — it blocks future
 * submissions, which is exactly what lowering a budget means.
 */
export async function setMlBudgetTotal({
	conversationId,
	totalMicroUsd,
	extraFilter = {},
}: {
	conversationId: ObjectId;
	totalMicroUsd: number;
	extraFilter?: Record<string, unknown>;
}): Promise<boolean> {
	const res = await collections.conversations.updateOne({ _id: conversationId, ...extraFilter }, [
		{
			$set: {
				mlBudget: {
					totalMicroUsd,
					spentMicroUsd: { $ifNull: ["$mlBudget.spentMicroUsd", 0] },
					reservations: { $ifNull: ["$mlBudget.reservations", []] },
				},
				updatedAt: new Date(),
			},
		},
	]);
	return res.matchedCount > 0;
}

export async function readMlBudget(conversationId: ObjectId): Promise<MlBudget | undefined> {
	const doc = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { mlBudget: 1 } }
	);
	return doc?.mlBudget;
}
