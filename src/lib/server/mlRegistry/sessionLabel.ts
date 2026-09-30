import { randomBytes } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { SessionJobLabels } from "$lib/server/mcp/jobLabels";

/** long enough for a submit reply to arrive, and the least time between two reconciles */
export const RECONCILE_DELAY_MS = 5 * 60_000;
/** past its timeout plus this a job cannot still be running */
const RECONCILE_SLACK_MS = 2 * 60 * 60 * 1000;

/** the value is drawn once, the first time the conversation runs in the mode */
export async function loadSessionJobLabels(conversationId: ObjectId): Promise<SessionJobLabels> {
	const now = new Date();
	const [row, jobs] = await Promise.all([
		collections.mlSessionLabels.findOneAndUpdate(
			{ _id: conversationId },
			{
				$setOnInsert: { value: randomBytes(8).toString("hex"), createdAt: now, updatedAt: now },
			},
			{ upsert: true, returnDocument: "after" }
		),
		collections.mlServices
			.find(
				{ conversationId, kind: "job", origin: "dispatched" },
				{ projection: { jobId: 1, name: 1 } }
			)
			.toArray(),
	]);
	if (!row.value) throw new Error("session label upsert returned no row");
	return {
		session: row.value.value,
		ownJobs: new Map(jobs.map((job) => [job.jobId, job.name])),
	};
}

/**
 * written before dispatch so a crash after the hub accepts the job still leaves the reconcile due,
 * a call the budget then refuses costs one listing and needs no release
 */
export async function markLabelledSubmission({
	conversationId,
	namespace,
	timeoutSeconds,
	now = new Date(),
}: {
	conversationId: ObjectId;
	namespace: string;
	timeoutSeconds: number;
	now?: Date;
}): Promise<void> {
	await collections.mlSessionLabels.updateOne(
		{ _id: conversationId },
		{
			$addToSet: { namespaces: namespace },
			$inc: { submissions: 1 },
			$min: { reconcileAt: new Date(now.getTime() + RECONCILE_DELAY_MS) },
			$max: {
				reconcileUntil: new Date(now.getTime() + timeoutSeconds * 1000 + RECONCILE_SLACK_MS),
			},
			$set: { updatedAt: now },
		}
	);
}
