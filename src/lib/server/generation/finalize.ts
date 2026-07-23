import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";

export interface ActiveRun {
	conversationId: ObjectId;
	messageId: string;
}

// This pod's in-flight runs, so a graceful shutdown can finalize them at once
// instead of leaving each to the reaper's ~90s sweep.
const activeRuns = new Map<string, ActiveRun>();

export function registerActiveRun(generationId: string, run: ActiveRun): void {
	activeRuns.set(generationId, run);
}

export function unregisterActiveRun(generationId: string): void {
	activeRuns.delete(generationId);
}

// The message flag — not just the generation status — is what every existing reader
// treats as terminal, so both must move together. Flip the generation first, guarded on
// `status: "running"`, so only one caller (a reaper on any pod, or the owner's shutdown)
// wins the claim; mark the message only on that win.
export async function markGenerationInterrupted(
	generationId: string,
	run: ActiveRun
): Promise<void> {
	const now = new Date();
	const claim = await collections.generations.updateOne(
		{ generationId, status: "running" },
		{ $set: { status: "interrupted", endedAt: now, updatedAt: now } }
	);
	// Lost the claim: the run completed or errored elsewhere first. Marking the message now
	// would flag a finished answer as stopped, so leave it untouched.
	if (claim.matchedCount === 0) return;
	await collections.conversations.updateOne(
		{
			_id: run.conversationId,
			"messages.id": run.messageId,
			"messages.interrupted": { $ne: true },
		},
		{ $set: { "messages.$.interrupted": true, "messages.$.updatedAt": now, updatedAt: now } }
	);
}

export async function finalizeActiveRunsOnExit(): Promise<void> {
	const runs = [...activeRuns.entries()];
	if (runs.length === 0) return;
	logger.info({ count: runs.length }, "[generation] finalizing in-flight runs on shutdown");
	await Promise.all(
		runs.map(([generationId, run]) =>
			markGenerationInterrupted(generationId, run).catch((err) =>
				logger.error({ err, generationId }, "[generation] failed to finalize run on shutdown")
			)
		)
	);
}
