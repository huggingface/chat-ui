import type { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";
import { isHfMcpServer } from "$lib/server/mcp/hf";
import { classifySubmission } from "$lib/server/mlBudget/guard";
import type {
	GuardedToolCall,
	GuardOutcome,
	GuardVerdict,
	ToolCallGuard,
} from "$lib/server/textGeneration/mcp/toolGuard";
import type { MlService } from "$lib/types/MlService";
import { listMlServices } from "./store";

// books nothing in before and emits no update, so it may sit anywhere in a chain
// a registry it cannot read lets the call through, a sandbox rule must never stop all compute

export const SANDBOX_FIRST_FAILED_JOBS = 2;

type Ticket = { kind: "sandbox-create" };

const isGpuFlavor = (flavor: string | undefined): boolean =>
	flavor !== undefined && !flavor.startsWith("cpu");

/** when the newest failure of the streak ended, undefined unless the last ended jobs all failed */
function failedStreakEnd(jobs: MlService[]): Date | undefined {
	let failed = 0;
	let newest: Date | undefined;
	for (const job of [...jobs].reverse()) {
		if (job.stage === "COMPLETED") break;
		if (job.stage !== "ERROR") continue;
		failed++;
		newest ??= job.endedAt ?? job.updatedAt;
	}
	return failed >= SANDBOX_FIRST_FAILED_JOBS ? newest : undefined;
}

const upSince = (sandbox: MlService, at: Date): boolean =>
	sandbox.createdAt > at || !sandbox.endedAt || sandbox.endedAt > at;

export const firstGpuJobRefusal = (flavor: string): string =>
	`Sandbox first: this would be the session's first GPU job, and no sandbox has been created yet. Nothing was submitted. Create one with hf_sandbox on the flavor this job uses (${flavor}), run the script there until it gets through a few steps at the real batch size and sequence length — sandbox_task can drive that — then submit once. If hf_sandbox create fails, this check lifts.`;

export const failedJobsRefusal = (flavor: string): string =>
	`Sandbox first: the last ${SANDBOX_FIRST_FAILED_JOBS} jobs failed, and no sandbox has been up since. Nothing was submitted. Reproduce the failure in a sandbox on the job's flavor (${flavor}) and run the failing step there until it passes, then submit once. If hf_sandbox create fails, this check lifts.`;

/** a failed job counts only once the poller has seen it end */
export function createSandboxFirstGuard({
	conversationId,
}: {
	conversationId: ObjectId;
}): ToolCallGuard {
	// a sandbox the account cannot create must not block the jobs it would have preceded
	let createFailed = false;

	return {
		allowParking: true,
		async before(call: GuardedToolCall): Promise<GuardVerdict> {
			if (!isHfMcpServer(call.serverUrl)) return { allow: true };
			const submission = classifySubmission(call);
			if (!submission || "blocked" in submission) return { allow: true };
			if (submission.kind === "sandbox") {
				return { allow: true, ticket: { kind: "sandbox-create" } satisfies Ticket };
			}
			if (createFailed) return { allow: true };

			let services: MlService[];
			try {
				services = await listMlServices(conversationId);
			} catch (err) {
				logger.warn(
					{ err: String(err), conversationId: conversationId.toString() },
					"[ml-registry] sandbox-first check skipped, the registry could not be read"
				);
				return { allow: true };
			}
			const sandboxes = services.filter((s) => s.kind === "sandbox");
			const jobs = services.filter((s) => s.kind === "job");

			const streakEnd = failedStreakEnd(jobs);
			if (streakEnd && !sandboxes.some((s) => upSince(s, streakEnd))) {
				return { allow: false, message: failedJobsRefusal(submission.flavor) };
			}
			if (isGpuFlavor(submission.flavor) && sandboxes.length === 0) {
				return { allow: false, message: firstGpuJobRefusal(submission.flavor) };
			}
			return { allow: true };
		},
		async after(ticket: unknown, outcome: GuardOutcome) {
			if ((ticket as Ticket | undefined)?.kind !== "sandbox-create") return undefined;
			if (outcome.status === "error" || outcome.status === "transport_error") createFailed = true;
			return undefined;
		},
	};
}
