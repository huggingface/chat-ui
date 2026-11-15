import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { pinnedHubToken } from "$lib/server/mlAssistant";
import { cancelJob, TERMINAL_STAGES } from "$lib/server/mlBudget/settle";
import type { TurnStatus } from "$lib/types/TurnState";

export type StopOutcome = { ok: true } | { ok: false; status: number; message: string };

const refused = (status: number, message: string): StopOutcome => ({
	ok: false,
	status,
	message,
});

/** stops it on the hub and leaves the end and the settle to the poller */
export async function stopSandbox({
	conversationId,
	serviceId,
	requestToken,
	now = new Date(),
}: {
	conversationId: ObjectId;
	serviceId: ObjectId;
	requestToken?: string;
	now?: Date;
}): Promise<StopOutcome> {
	const service = await collections.mlServices.findOne({ _id: serviceId, conversationId });
	if (!service || service.kind !== "sandbox") {
		return refused(404, "No such sandbox in this conversation.");
	}
	if (service.origin !== "dispatched") {
		return refused(409, "This sandbox was not created in this conversation.");
	}
	if (TERMINAL_STAGES.has(service.stage) || service.pollStoppedReason !== undefined) {
		return refused(409, "This sandbox has already ended.");
	}
	// a repeat could fail on a sandbox already stopping and take back the mark the first one left
	if (service.stopRequestedAt) return { ok: true };
	// pinned first like the poller, a sandbox created under it can only be stopped as it
	const token = pinnedHubToken() ?? requestToken;
	if (!token) return refused(403, "Sign in again to stop this sandbox.");

	// marked first, so a turn starting after the check and a poll reading the end both see it
	const marked = await collections.mlServices.updateOne(
		{ _id: serviceId, stage: { $nin: [...TERMINAL_STAGES] }, stopRequestedAt: { $exists: false } },
		{ $set: { stopRequestedAt: now, updatedAt: now } }
	);
	if (marked.matchedCount === 0) {
		// ended since the read, or a stop from another tab marked it first
		const current = await collections.mlServices.findOne({ _id: serviceId });
		return current?.stopRequestedAt && !TERMINAL_STAGES.has(current.stage)
			? { ok: true }
			: refused(409, "This sandbox has already ended.");
	}
	const unmark = () =>
		collections.mlServices.updateOne(
			{ _id: serviceId, stopRequestedAt: now },
			{ $unset: { stopRequestedAt: "" } }
		);

	const running = await collections.turnStates.countDocuments(
		{ conversationId, status: "running" satisfies TurnStatus },
		{ limit: 1 }
	);
	if (running > 0) {
		await unmark();
		return refused(409, "The intern may be using this sandbox. Stop it once the turn ends.");
	}

	const result = await cancelJob({ namespace: service.namespace, jobId: service.jobId, token });
	const logFields = { conversationId: conversationId.toString(), jobId: service.jobId };
	if (result.state === "cancelled" || result.state === "gone") {
		logger.info({ ...logFields, result: result.state }, "[mlRegistry] user stopped a sandbox");
		return { ok: true };
	}

	await unmark();
	logger.warn({ ...logFields, ...result }, "[mlRegistry] stopping a sandbox failed");
	return result.state === "refused"
		? refused(502, `The Hub refused to stop the sandbox (HTTP ${result.status}).`)
		: refused(502, "Could not reach the Hub to stop the sandbox. Try again.");
}
