import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MlService } from "$lib/types/MlService";
import { claimServiceEvents } from "./events";
import { harnessEventText, markHarnessEventDelivered, pendingHarnessEvent } from "./midTurn";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const NOW = new Date("2026-09-25T12:00:00Z");
const JOB_ID = "0123456789abcdef01234567";
const OTHER_JOB_ID = "fedcbafedcbafedcbafedcba";

function conversation(): ObjectId {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
}

async function insertService(
	conversationId: ObjectId,
	overrides: Partial<MlService> = {}
): Promise<MlService> {
	const service: MlService = {
		_id: new ObjectId(),
		conversationId,
		kind: "job",
		jobId: JOB_ID,
		namespace: "testuser",
		name: "sft-smoke",
		stage: "ERROR",
		stageBeforeEnd: "RUNNING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		flavor: "a10g-small",
		startedAt: new Date(NOW.getTime() - 137_000),
		endedAt: NOW,
		eventPendingSince: NOW,
		createdAt: new Date(NOW.getTime() - 200_000),
		updatedAt: NOW,
		...overrides,
	};
	await collections.mlServices.insertOne(service);
	return service;
}

describe.sequential("mid-turn events", () => {
	it("builds one update from every pending end without claiming them", async () => {
		const conversationId = conversation();
		const failed = await insertService(conversationId);
		const done = await insertService(conversationId, {
			jobId: OTHER_JOB_ID,
			name: "eval",
			stage: "COMPLETED",
		});

		const pending = await pendingHarnessEvent(conversationId, "call-uuid", NOW);

		expect(pending?.update).toEqual({
			type: MessageUpdateType.HarnessEvent,
			events: [
				{
					serviceId: failed._id.toString(),
					kind: "job",
					jobId: JOB_ID,
					name: "sft-smoke",
					flavor: "a10g-small",
					from: "RUNNING",
					to: "ERROR",
					ranSeconds: 137,
					at: NOW.getTime(),
				},
				expect.objectContaining({ serviceId: done._id.toString(), to: "COMPLETED" }),
			],
			text:
				"[Harness event, not part of this tool result]\n" +
				`Job sft-smoke (a10g-small, id ${JOB_ID}) failed: ERROR after 2m17s. Read its logs with check_job before changing anything.\n` +
				`Job eval (a10g-small, id ${OTHER_JOB_ID}) completed after 2m17s. Confirm the result and that its outputs were pushed with check_job before reporting it.`,
			afterToolUuid: "call-uuid",
		});
		expect(JSON.parse(JSON.stringify(pending?.update))).toEqual(pending?.update);
		const rows = await collections.mlServices.find({ conversationId }).toArray();
		expect(rows.every((row) => row.eventPendingSince !== undefined)).toBe(true);
	});

	it("builds nothing when no end is pending", async () => {
		const conversationId = conversation();
		const running = await insertService(conversationId, { stage: "RUNNING" });
		await collections.mlServices.updateOne(
			{ _id: running._id },
			{ $unset: { eventPendingSince: "" } }
		);
		await insertService(conversation());

		expect(await pendingHarnessEvent(conversationId, "call-uuid", NOW)).toBeUndefined();
	});

	it("clears the rows once delivered, so neither a wait nor the next round tells them again", async () => {
		const conversationId = conversation();
		await insertService(conversationId);
		const pending = await pendingHarnessEvent(conversationId, "call-uuid", NOW);
		if (!pending) throw new Error("expected a pending event");

		await markHarnessEventDelivered(conversationId, pending.services, NOW);

		const [row] = await collections.mlServices.find({ conversationId }).toArray();
		expect(row.eventPendingSince).toBeUndefined();
		expect(row.lastReportedStage).toBe("ERROR");
		expect(await pendingHarnessEvent(conversationId, "next-uuid", NOW)).toBeUndefined();
		expect(await claimServiceEvents(conversationId, NOW)).toEqual([]);
	});

	it("keeps an end marked again after the read for the next delivery", async () => {
		const conversationId = conversation();
		const service = await insertService(conversationId);
		const pending = await pendingHarnessEvent(conversationId, "call-uuid", NOW);
		if (!pending) throw new Error("expected a pending event");
		const later = new Date(NOW.getTime() + 5_000);
		await collections.mlServices.updateOne(
			{ _id: service._id },
			{ $set: { eventPendingSince: later, stage: "CANCELED" } }
		);

		await markHarnessEventDelivered(conversationId, pending.services, NOW);

		const [row] = await collections.mlServices.find({ conversationId }).toArray();
		expect(row.eventPendingSince).toEqual(later);
	});

	it("marks what is left when a wait claimed one of the rows between the read and the mark", async () => {
		const conversationId = conversation();
		await insertService(conversationId);
		await insertService(conversationId, { jobId: OTHER_JOB_ID, stage: "COMPLETED" });
		const pending = await pendingHarnessEvent(conversationId, "call-uuid", NOW);
		if (!pending) throw new Error("expected a pending event");
		await collections.mlServices.updateOne(
			{ conversationId, jobId: OTHER_JOB_ID },
			{ $unset: { eventPendingSince: "" }, $set: { lastReportedStage: "COMPLETED" } }
		);

		await markHarnessEventDelivered(conversationId, pending.services, NOW);

		const rows = await collections.mlServices.find({ conversationId }).toArray();
		expect(rows.map((row) => row.eventPendingSince)).toEqual([undefined, undefined]);
	});

	it("names a sandbox by its handle", () => {
		expect(
			harnessEventText([
				{
					serviceId: new ObjectId(),
					kind: "sandbox",
					jobId: JOB_ID,
					handle: `hfsb2:testuser:${JOB_ID}`,
					from: "RUNNING",
					to: "CANCELED",
					at: NOW,
				},
			])
		).toBe(
			"[Harness event, not part of this tool result]\n" +
				`Sandbox hfsb2:testuser:${JOB_ID} stopped: CANCELED. Create a new one if you still need it.`
		);
	});
});
