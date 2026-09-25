import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { McpElicitation } from "$lib/types/McpElicitation";
import type { MlService } from "$lib/types/MlService";
import type { ParkedCall } from "$lib/types/ParkedCall";
import { claimServiceEvents, conversationsAwaitingEvents, deliverServiceEvents } from "./events";
import { pollDueServices, pollService } from "./poller";

const switches = vi.hoisted(() => ({ events: true }));
vi.mock("./enabled", () => ({
	mlServicePollerEnabled: () => true,
	mlServiceEventsEnabled: () => switches.events,
}));

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];
const sessionIds: string[] = [];

afterEach(async () => {
	switches.events = true;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.parkedCalls.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.mcpElicitations.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.conversations.deleteMany({ _id: { $in: conversationIds } });
	await collections.sessions.deleteMany({ sessionId: { $in: sessionIds } });
	conversationIds.length = 0;
	sessionIds.length = 0;
});

const NOW = new Date("2026-09-25T12:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const JOB_ID = "0123456789abcdef01234567";
const OTHER_JOB_ID = "fedcbafedcbafedcbafedcba";
const TOKEN = "hf_test";

async function insertConversation(): Promise<ObjectId> {
	const _id = new ObjectId();
	conversationIds.push(_id);
	const sessionId = `events-test-${_id.toString()}`;
	sessionIds.push(sessionId);
	await collections.conversations.insertOne({
		_id,
		title: "events test",
		model: "test-model",
		messages: [],
		createdAt: NOW,
		updatedAt: NOW,
		sessionId,
		mlAssistant: true,
	});
	// rebuildIdentity compares the token expiry with the wall clock, not with NOW
	const expiresAt = new Date(Date.now() + 24 * 60 * MINUTE);
	await collections.sessions.insertOne({
		_id: new ObjectId(),
		sessionId,
		userId: new ObjectId(),
		expiresAt,
		createdAt: NOW,
		updatedAt: NOW,
		oauth: { token: { value: TOKEN, expiresAt } },
	});
	return _id;
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
		stage: "RUNNING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		flavor: "a10g-small",
		timeoutSeconds: 3600,
		startedAt: new Date(NOW.getTime() - 3 * MINUTE),
		createdAt: new Date(NOW.getTime() - 4 * MINUTE),
		updatedAt: NOW,
		nextPollAt: NOW,
		...overrides,
	};
	await collections.mlServices.insertOne(service);
	return service;
}

const endedUnreported = (overrides: Partial<MlService> = {}): Partial<MlService> => ({
	stage: "ERROR",
	stageBeforeEnd: "RUNNING",
	endedAt: new Date(NOW.getTime() - 43 * SECOND),
	eventPendingSince: NOW,
	nextPollAt: undefined,
	...overrides,
});

async function insertPark(
	conversationId: ObjectId,
	overrides: Partial<ParkedCall> = {}
): Promise<ParkedCall> {
	const park: ParkedCall = {
		_id: new ObjectId(),
		parkedCallId: new ObjectId().toString(),
		conversationId,
		messageId: "msg-1",
		toolCallId: "call-1",
		toolUuid: "uuid-1",
		kind: "timer",
		status: "waiting",
		reason: "the smoke job",
		resumeAt: new Date(NOW.getTime() + 20 * MINUTE),
		attempts: 0,
		createdAt: new Date(NOW.getTime() - MINUTE),
		updatedAt: new Date(NOW.getTime() - MINUTE),
		...overrides,
	};
	await collections.parkedCalls.insertOne(park);
	return park;
}

async function readService(id: ObjectId): Promise<MlService> {
	const row = await collections.mlServices.findOne({ _id: id });
	if (!row) throw new Error(`service ${id.toString()} is gone`);
	return row;
}

async function readPark(id: ObjectId): Promise<ParkedCall> {
	const row = await collections.parkedCalls.findOne({ _id: id });
	if (!row) throw new Error(`park ${id.toString()} is gone`);
	return row;
}

function stubJobApi(body: Record<string, unknown>) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))
	);
}

describe.sequential("marking an end", () => {
	it("marks a dispatched job that ends as pending and remembers the stage it left", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		stubJobApi({ status: { stage: "ERROR", message: "exit code 1" } });

		await pollService(service, TOKEN, NOW);

		const row = await readService(service._id);
		expect(row).toMatchObject({
			stage: "ERROR",
			stageBeforeEnd: "RUNNING",
			eventPendingSince: NOW,
		});
		expect(row.lastReportedStage).toBeUndefined();
	});

	it("reports a dispatched sandbox the poller never read before it ended", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, { kind: "sandbox", stage: "UNKNOWN" });
		stubJobApi({ status: { stage: "CANCELED" } });

		await pollService(service, TOKEN, NOW);

		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
	});

	it("does not report a discovered row that had already ended on its first poll", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, { origin: "discovered", stage: "UNKNOWN" });
		stubJobApi({ status: { stage: "COMPLETED" } });

		await pollService(service, TOKEN, NOW);

		const row = await readService(service._id);
		expect(row.eventPendingSince).toBeUndefined();
		expect(row.lastReportedStage).toBe("COMPLETED");
	});

	it("reports a discovered row once the poller has seen it open", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, { origin: "discovered" });
		stubJobApi({ status: { stage: "ERROR" } });

		await pollService(service, TOKEN, NOW);

		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
	});

	it("does not report an end twice when a retried dispatch reopens the row", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, {
			stage: "SCHEDULING",
			lastReportedStage: "ERROR",
		});
		stubJobApi({ status: { stage: "ERROR" } });

		await pollService(service, TOKEN, NOW);

		expect((await readService(service._id)).eventPendingSince).toBeUndefined();
	});

	it("marks nothing with the switch off", async () => {
		switches.events = false;
		const conversationId = await insertConversation();
		const discovered = await insertService(conversationId, {
			origin: "discovered",
			stage: "UNKNOWN",
		});
		const dispatched = await insertService(conversationId, { jobId: OTHER_JOB_ID });
		stubJobApi({ status: { stage: "ERROR" } });

		await pollService(discovered, TOKEN, NOW);
		await pollService(dispatched, TOKEN, NOW);

		for (const service of [discovered, dispatched]) {
			const row = await readService(service._id);
			expect(row.stage).toBe("ERROR");
			expect(row.eventPendingSince).toBeUndefined();
			expect(row.lastReportedStage).toBeUndefined();
		}
	});
});

describe.sequential("delivering into a parked wait", () => {
	it("wakes the wait with the event, keeps the deadline it asked for and clears the mark", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId);

		await deliverServiceEvents([conversationId], NOW);

		const after = await readPark(park._id);
		expect(after.status).toBe("waiting");
		expect(after.resumeAt).toEqual(NOW);
		expect(after.plannedResumeAt).toEqual(park.resumeAt);
		expect(after.wokeByHarnessAt).toEqual(NOW);
		expect(after.wokeEarlyAt).toBeUndefined();
		expect(after.serviceEvents).toEqual([
			{
				serviceId: service._id,
				kind: "job",
				jobId: JOB_ID,
				name: "sft-smoke",
				flavor: "a10g-small",
				from: "RUNNING",
				to: "ERROR",
				ranSeconds: 137,
				at: new Date(NOW.getTime() - 43 * SECOND),
			},
		]);
		const row = await readService(service._id);
		expect(row.eventPendingSince).toBeUndefined();
		expect(row.lastReportedStage).toBe("ERROR");
	});

	it("keeps one entry when a crash before clearing the row delivers an event twice", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId);
		vi.spyOn(collections.mlServices, "bulkWrite").mockRejectedValueOnce(new Error("pod died"));

		await deliverServiceEvents([conversationId], NOW);
		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);

		const later = new Date(NOW.getTime() + 5 * SECOND);
		await deliverServiceEvents([conversationId], later);

		const after = await readPark(park._id);
		expect(after.serviceEvents).toHaveLength(1);
		expect(after.resumeAt).toEqual(NOW);
		expect(after.plannedResumeAt).toEqual(park.resumeAt);
		expect((await readService(service._id)).eventPendingSince).toBeUndefined();
	});

	it("adds a second service's end to a wait that is woken but not yet resumed", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId);
		await deliverServiceEvents([conversationId], NOW);

		await insertService(
			conversationId,
			endedUnreported({ jobId: OTHER_JOB_ID, stage: "COMPLETED" })
		);
		await deliverServiceEvents([conversationId], new Date(NOW.getTime() + 5 * SECOND));

		const after = await readPark(park._id);
		expect(after.serviceEvents?.map((e) => [e.jobId, e.to])).toEqual([
			[JOB_ID, "ERROR"],
			[OTHER_JOB_ID, "COMPLETED"],
		]);
		expect(after.wokeByHarnessAt).toEqual(NOW);
	});

	it("leaves the events pending when the wait is no longer waiting", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId, { status: "resuming", takenAt: NOW });

		await deliverServiceEvents([conversationId], NOW);

		const after = await readPark(park._id);
		expect(after.serviceEvents).toBeUndefined();
		expect(after.resumeAt).toEqual(park.resumeAt);
		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
	});

	it("leaves the events pending when nothing is parked", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());

		await deliverServiceEvents([conversationId], NOW);

		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
	});

	it("never touches an ask_user_question park", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());
		const ask: McpElicitation = {
			_id: new ObjectId(),
			elicitationId: "ask-1",
			conversationId,
			generationId: "gen-1",
			status: "pending",
			request: {
				elicitationId: "ask-1",
				server: "assistant",
				mode: "form",
				message: "Which?",
				fields: [],
			},
			pending: { kind: "ask", messageId: "msg-1", toolCallId: "call-2", toolUuid: "uuid-2" },
			createdAt: NOW,
			updatedAt: NOW,
		};
		await collections.mcpElicitations.insertOne(ask);

		await deliverServiceEvents([conversationId], NOW);

		expect(await collections.mcpElicitations.findOne({ _id: ask._id })).toEqual(ask);
		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
	});

	it("hands a wait that is already due its events without calling it early", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId, {
			resumeAt: new Date(NOW.getTime() - SECOND),
		});

		await deliverServiceEvents([conversationId], NOW);

		const after = await readPark(park._id);
		expect(after.serviceEvents).toHaveLength(1);
		expect(after.resumeAt).toEqual(park.resumeAt);
		expect(after.wokeByHarnessAt).toBeUndefined();
		expect(after.plannedResumeAt).toBeUndefined();
	});

	it("never makes a wait due before the run that parked it has had time to save", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId, endedUnreported());
		const createdAt = new Date(NOW.getTime() - 2 * SECOND);
		const park = await insertPark(conversationId, { createdAt });

		await deliverServiceEvents([conversationId], NOW);

		const after = await readPark(park._id);
		expect(after.resumeAt).toEqual(new Date(createdAt.getTime() + 15 * SECOND));
		expect(after.wokeByHarnessAt).toEqual(NOW);
	});

	it("stores a model-written name that looks like a field path as written", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId, endedUnreported({ name: "$stage" }));
		const park = await insertPark(conversationId);

		await deliverServiceEvents([conversationId], NOW);

		expect((await readPark(park._id)).serviceEvents?.[0].name).toBe("$stage");
	});

	it("wakes a parked wait once for two services ending in the same tick", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId);
		await insertService(conversationId, {
			jobId: OTHER_JOB_ID,
			kind: "sandbox",
			name: undefined,
			handle: `hfsb2:testuser:${OTHER_JOB_ID}`,
		});
		const park = await insertPark(conversationId);
		stubJobApi({ status: { stage: "ERROR" }, finishedAt: "2026-09-25T11:59:30Z" });

		await pollDueServices(NOW);

		const after = await readPark(park._id);
		expect(after.resumeAt).toEqual(NOW);
		expect(after.serviceEvents?.map((e) => [e.kind, e.to]).sort()).toEqual([
			["job", "ERROR"],
			["sandbox", "ERROR"],
		]);
		const rows = await collections.mlServices.find({ conversationId }).toArray();
		expect(rows.map((r) => r.eventPendingSince)).toEqual([undefined, undefined]);
	});
});

describe.sequential("delivering on every tick", () => {
	it("reaches a wait that parked after the end was marked", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());
		const park = await insertPark(conversationId);

		expect(await pollDueServices(NOW)).toEqual([]);

		expect((await readPark(park._id)).serviceEvents).toHaveLength(1);
		expect((await readService(service._id)).eventPendingSince).toBeUndefined();
	});

	it("retries a delivery that failed on an earlier tick", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		const park = await insertPark(conversationId);
		stubJobApi({ status: { stage: "ERROR" } });
		vi.spyOn(collections.parkedCalls, "updateOne").mockRejectedValueOnce(
			new Error("write refused")
		);

		await pollDueServices(NOW);
		expect((await readService(service._id)).eventPendingSince).toEqual(NOW);
		expect((await readPark(park._id)).serviceEvents).toBeUndefined();

		await pollDueServices(new Date(NOW.getTime() + 5 * SECOND));
		expect((await readPark(park._id)).serviceEvents?.map((e) => e.to)).toEqual(["ERROR"]);
		expect((await readService(service._id)).eventPendingSince).toBeUndefined();
	});

	it("leaves a conversation with pending events and no parked wait alone", async () => {
		const conversationId = await insertConversation();
		await insertService(conversationId, endedUnreported());
		await insertPark(conversationId, { status: "resumed" });
		await insertPark(new ObjectId());

		expect(await conversationsAwaitingEvents()).toEqual([]);
	});
});

describe.sequential("claiming for a wait about to park", () => {
	it("hands each pending event to one of two racing callers", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, endedUnreported());

		const [a, b] = await Promise.all([
			claimServiceEvents(conversationId, NOW),
			claimServiceEvents(conversationId, NOW),
		]);

		expect([...a, ...b].map((e) => e.serviceId)).toEqual([service._id]);
		const row = await readService(service._id);
		expect(row.eventPendingSince).toBeUndefined();
		expect(row.lastReportedStage).toBe("ERROR");
		expect(await claimServiceEvents(conversationId, NOW)).toEqual([]);
	});
});
