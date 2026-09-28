import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { SESSION_LABEL_KEY } from "$lib/server/mcp/jobLabels";
import { listLabelledJobs, TERMINAL_STAGES } from "$lib/server/mlBudget/settle";
import type { MlSessionLabel } from "$lib/types/MlSessionLabel";
import { RECONCILE_DELAY_MS } from "./sessionLabel";
import { recordReconciledService, UNKNOWN_STAGE } from "./store";

// one listing per burst of submissions, after that the per job poll takes over

/** the claim pushes the due time out by the delay, which doubles as the retry */
export async function claimDueReconcile(now: Date): Promise<MlSessionLabel | null> {
	const claimed = await collections.mlSessionLabels.findOneAndUpdate(
		{ reconcileAt: { $lte: now } },
		{ $set: { reconcileAt: new Date(now.getTime() + RECONCILE_DELAY_MS) } },
		{ sort: { reconcileAt: 1 }, returnDocument: "after" }
	);
	return claimed?.value ?? null;
}

/** returns rows added, a failed listing or missing token leaves the claim due time as the retry */
export async function reconcileSession(
	session: MlSessionLabel,
	token: string | undefined,
	now: Date
): Promise<number> {
	const expired = session.reconcileUntil !== undefined && now > session.reconcileUntil;
	let listedAll = !!token && !expired;
	let added = 0;
	if (token && !expired) {
		for (const namespace of session.namespaces ?? []) {
			const jobs = await listLabelledJobs({
				namespace,
				labels: { [SESSION_LABEL_KEY]: session.value },
				token,
			});
			if (!jobs) {
				listedAll = false;
				continue;
			}
			for (const job of jobs) {
				const inserted = await recordReconciledService({
					conversationId: session._id,
					jobId: job.jobId,
					namespace,
					// an ended job goes in unread so the poller records its end and raises the event
					stage: TERMINAL_STAGES.has(job.stage) ? UNKNOWN_STAGE : job.stage,
					name: job.labels.name,
					flavor: job.flavor,
					timeoutSeconds: job.timeoutSeconds,
					createdAt: job.createdAt,
				});
				if (!inserted) continue;
				added++;
				logger.warn(
					{ conversationId: session._id.toString(), jobId: job.jobId, stage: job.stage },
					"[mlReconcile] recorded a labelled job whose submit reply was never read"
				);
			}
		}
	}
	if (listedAll || expired) {
		// a submission marked since the claim keeps it due
		await collections.mlSessionLabels.updateOne(
			{ _id: session._id, submissions: session.submissions },
			{
				$unset: { reconcileAt: "" },
				$set: { updatedAt: now, ...(listedAll ? { reconciledAt: now } : {}) },
			}
		);
	}
	return added;
}
