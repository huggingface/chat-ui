import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { readMlBudget } from "$lib/server/mlBudget/budget";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";
import type { MlService } from "$lib/types/MlService";
import { claimDueService, pollDueServices, pollService } from "./poller";
import { recordDiscoveredService, recordDispatchedService, sandboxHandle } from "./store";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];
const sessionIds: string[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	await collections.conversations.deleteMany({ _id: { $in: conversationIds } });
	await collections.sessions.deleteMany({ sessionId: { $in: sessionIds } });
	conversationIds.length = 0;
	sessionIds.length = 0;
});

const NOW = new Date("2026-09-25T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const JOB_ID = "0123456789abcdef01234567";
const OTHER_JOB_ID = "fedcbafedcbafedcbafedcba";
const SANDBOX_JOB_ID = "abcdefabcdefabcdefabcdef";
const TOKEN = "hf_test";

async function insertSession(sessionId: string, { expired = false } = {}): Promise<void> {
	sessionIds.push(sessionId);
	// rebuildIdentity compares the token expiry with the wall clock, not with NOW
	const expiresAt = new Date(Date.now() + (expired ? -1 : 1) * 24 * HOUR);
	await collections.sessions.insertOne({
		_id: new ObjectId(),
		sessionId,
		userId: new ObjectId(),
		expiresAt,
		createdAt: NOW,
		updatedAt: NOW,
		oauth: { token: { value: TOKEN, expiresAt } },
	});
}

async function insertConversation({
	mlBudget,
	session = "live",
}: { mlBudget?: MlBudget; session?: "live" | "expired" | "none" } = {}): Promise<ObjectId> {
	const _id = new ObjectId();
	conversationIds.push(_id);
	const sessionId = `poller-test-${_id.toString()}`;
	await collections.conversations.insertOne({
		_id,
		title: "poller test",
		model: "test-model",
		messages: [],
		createdAt: NOW,
		updatedAt: NOW,
		sessionId,
		mlAssistant: true,
		...(mlBudget ? { mlBudget } : {}),
	});
	if (session !== "none") await insertSession(sessionId, { expired: session === "expired" });
	return _id;
}

async function insertService(
	conversationId: ObjectId,
	overrides: Partial<MlService> = {},
	{ unscheduled = false } = {}
): Promise<MlService> {
	const service: MlService = {
		_id: new ObjectId(),
		conversationId,
		kind: "job",
		jobId: JOB_ID,
		namespace: "testuser",
		stage: "SCHEDULING",
		origin: "dispatched",
		hubUrl: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		flavor: "t4-small",
		timeoutSeconds: 3600,
		reservationKey: "gen:call-1",
		createdAt: NOW,
		updatedAt: NOW,
		nextPollAt: NOW,
		...overrides,
	};
	if (unscheduled) delete service.nextPollAt;
	await collections.mlServices.insertOne(service);
	return service;
}

async function readService(id: ObjectId): Promise<MlService> {
	const row = await collections.mlServices.findOne({ _id: id });
	if (!row) throw new Error(`service ${id.toString()} is gone`);
	return row;
}

function stubJobApi(body: Record<string, unknown> | { notFound: true } | { offline: true }) {
	const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		if ("offline" in body) throw new Error("offline");
		return "notFound" in body
			? { ok: false, status: 404, json: async () => ({}) }
			: { ok: true, status: 200, json: async () => body };
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

// t4-small at 6667 micro usd per minute with a 1h timeout, ceiling 400_020
const reservation = (overrides: Partial<MlBudgetReservation> = {}): MlBudgetReservation => ({
	key: "gen:call-1",
	kind: "job",
	flavor: "t4-small",
	priceMicroUsdPerMinute: 6667,
	timeoutSeconds: 3600,
	ceilingMicroUsd: 400_020,
	createdAt: NOW,
	jobId: JOB_ID,
	namespace: "testuser",
	...overrides,
});

const budgetWith = (...reservations: MlBudgetReservation[]): MlBudget => ({
	totalMicroUsd: 10_000_000,
	spentMicroUsd: 0,
	reservations,
});

const RUNNING_BODY = {
	status: { stage: "RUNNING", message: null },
	startedAt: "2026-09-25T11:58:00Z",
	flavor: "t4-small",
	timeoutSeconds: 3600,
};

describe.sequential("claimDueService", () => {
	it("hands a due row to exactly one of two racing claims", async () => {
		const conversationId = await insertConversation({ session: "none" });
		const service = await insertService(conversationId);
		const claims = await Promise.all([claimDueService(NOW), claimDueService(NOW)]);
		expect(claims.filter((c) => c !== null)).toHaveLength(1);
		const row = await readService(service._id);
		expect(row.nextPollAt?.getTime()).toBeGreaterThan(NOW.getTime());
		expect(await claimDueService(NOW)).toBeNull();
	});

	it("treats a row that predates the schedule as due", async () => {
		const conversationId = await insertConversation({ session: "none" });
		const service = await insertService(conversationId, {}, { unscheduled: true });
		expect((await claimDueService(NOW))?._id).toEqual(service._id);
	});

	it("never claims a finished, stopped or not yet due row", async () => {
		const conversationId = await insertConversation({ session: "none" });
		await insertService(
			conversationId,
			{ stage: "COMPLETED", endedAt: NOW },
			{ unscheduled: true }
		);
		await insertService(
			conversationId,
			{ jobId: OTHER_JOB_ID, pollStoppedReason: "gave up" },
			{ unscheduled: true }
		);
		await insertService(conversationId, {
			jobId: SANDBOX_JOB_ID,
			nextPollAt: new Date(NOW.getTime() + 1),
		});
		expect(await claimDueService(NOW)).toBeNull();
	});
});

describe.sequential("pollService", () => {
	it("records a running job and one history entry per stage change", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		stubJobApi(RUNNING_BODY);

		const first = await pollService(service, TOKEN, NOW);
		expect(first).toMatchObject({ previousStage: "SCHEDULING", stage: "RUNNING", terminal: false });
		let row = await readService(service._id);
		expect(row.stage).toBe("RUNNING");
		expect(row.startedAt).toEqual(new Date("2026-09-25T11:58:00Z"));
		expect(row.lastPolledAt).toEqual(NOW);
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 5_000));
		expect(row.stageHistory).toEqual([{ stage: "RUNNING", at: NOW }]);
		expect(row.createdAt).toEqual(NOW);
		expect(row.endedAt).toBeUndefined();

		const later = new Date(NOW.getTime() + 5_000);
		const second = await pollService(row, TOKEN, later);
		expect(second.previousStage).toBe(second.stage);
		row = await readService(service._id);
		expect(row.stageHistory).toHaveLength(1);
		expect(row.lastPolledAt).toEqual(later);
		expect(row.nextPollAt).toEqual(new Date(later.getTime() + 5_000));
	});

	it("slows down as a job keeps running and keeps a message the Hub attaches", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, {
			stage: "RUNNING",
			startedAt: new Date(NOW.getTime() - 20 * MINUTE),
		});
		stubJobApi({ status: { stage: "RUNNING", message: "still going" } });
		await pollService(service, TOKEN, NOW);
		const row = await readService(service._id);
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 15_000));
		expect(row.stageMessage).toBe("still going");
		expect(row.stageHistory).toBeUndefined();
	});

	it("fills in what a discovered row did not know", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, {
			kind: "sandbox",
			jobId: SANDBOX_JOB_ID,
			handle: sandboxHandle("testuser", SANDBOX_JOB_ID),
			stage: "UNKNOWN",
			origin: "discovered",
			flavor: undefined,
			timeoutSeconds: undefined,
			reservationKey: undefined,
		});
		stubJobApi({ status: { stage: "RUNNING" }, flavor: "cpu-basic", timeout_seconds: 86400 });
		await pollService(service, TOKEN, NOW);
		const row = await readService(service._id);
		expect(row).toMatchObject({ stage: "RUNNING", flavor: "cpu-basic", timeoutSeconds: 86400 });
		// no start from the hub, the fast window runs from the first sighting
		expect(row.startedAt).toEqual(NOW);
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 30_000));
	});

	it("ends a job, unschedules it and settles its hold", async () => {
		const conversationId = await insertConversation({ mlBudget: budgetWith(reservation()) });
		const service = await insertService(conversationId, {
			stage: "RUNNING",
			startedAt: new Date("2026-09-25T11:50:00Z"),
		});
		stubJobApi({
			status: { stage: "COMPLETED", message: null },
			startedAt: "2026-09-25T11:50:00Z",
			finishedAt: "2026-09-25T11:59:30Z", // 9.5 min, billed 10
		});

		const outcome = await pollService(service, TOKEN, NOW);
		expect(outcome).toMatchObject({ previousStage: "RUNNING", stage: "COMPLETED", terminal: true });
		const row = await readService(service._id);
		expect(row.stage).toBe("COMPLETED");
		expect(row.endedAt).toEqual(new Date("2026-09-25T11:59:30Z"));
		expect(row.nextPollAt).toBeUndefined();
		expect(row.stageHistory).toEqual([{ stage: "COMPLETED", at: NOW }]);
		const budget = await readMlBudget(conversationId);
		expect(budget?.reservations).toHaveLength(0);
		expect(budget?.spentMicroUsd).toBe(6667 * 10);

		expect(await claimDueService(new Date(NOW.getTime() + HOUR))).toBeNull();
	});

	it("records a job the Hub no longer knows as deleted and settles at the ceiling", async () => {
		const conversationId = await insertConversation({ mlBudget: budgetWith(reservation()) });
		const service = await insertService(conversationId);
		stubJobApi({ notFound: true });

		const outcome = await pollService(service, TOKEN, NOW);
		expect(outcome).toMatchObject({ stage: "DELETED", terminal: true });
		const row = await readService(service._id);
		expect(row.stage).toBe("DELETED");
		expect(row.endedAt).toEqual(NOW);
		expect(row.nextPollAt).toBeUndefined();
		expect((await readMlBudget(conversationId))?.spentMicroUsd).toBe(400_020);
	});

	it("leaves a conversation without a budget alone when its job ends", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		stubJobApi({ status: { stage: "ERROR", message: "exit code 1" } });
		await pollService(service, TOKEN, NOW);
		const row = await readService(service._id);
		expect(row).toMatchObject({ stage: "ERROR", stageMessage: "exit code 1", endedAt: NOW });
		expect((await readMlBudget(conversationId))?.reservations).toBeUndefined();
	});

	it("backs off after a failed lookup and keeps the stage", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		stubJobApi({ offline: true });

		const outcome = await pollService(service, TOKEN, NOW);
		expect(outcome).toMatchObject({ previousStage: "SCHEDULING", stage: "SCHEDULING" });
		let row = await readService(service._id);
		expect(row.stage).toBe("SCHEDULING");
		expect(row.pollFailures).toBe(1);
		expect(row.lastPolledAt).toBeUndefined();
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 15_000));

		await pollService(row, TOKEN, NOW);
		row = await readService(service._id);
		expect(row.pollFailures).toBe(2);
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 30_000));

		stubJobApi(RUNNING_BODY);
		await pollService(row, TOKEN, NOW);
		expect((await readService(service._id)).pollFailures).toBeUndefined();
	});

	it("waits for a token without failing the row, and forgets the wait on the next success", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		const fetchMock = stubJobApi(RUNNING_BODY);

		const outcome = await pollService(service, undefined, NOW);
		expect(outcome).toMatchObject({ previousStage: "SCHEDULING", stage: "SCHEDULING" });
		expect(fetchMock).not.toHaveBeenCalled();
		let row = await readService(service._id);
		expect(row.stage).toBe("SCHEDULING");
		expect(row.tokenMissingSince).toEqual(NOW);
		expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 5 * MINUTE));

		const later = new Date(NOW.getTime() + 5 * MINUTE);
		await pollService(row, undefined, later);
		row = await readService(service._id);
		expect(row.tokenMissingSince).toEqual(NOW);

		await pollService(row, TOKEN, later);
		row = await readService(service._id);
		expect(row.tokenMissingSince).toBeUndefined();
		expect(row.stage).toBe("RUNNING");
	});

	it("stops a row past its timeout that it can no longer look up", async () => {
		const conversationId = await insertConversation();
		const createdAt = new Date(NOW.getTime() - (3600 * 1000 + 2 * HOUR + MINUTE));
		const offline = await insertService(conversationId, { createdAt });
		const noToken = await insertService(conversationId, { jobId: OTHER_JOB_ID, createdAt });
		stubJobApi({ offline: true });

		await pollService(offline, TOKEN, NOW);
		await pollService(noToken, undefined, NOW);
		for (const service of [offline, noToken]) {
			const row = await readService(service._id);
			expect(row.stage).toBe("SCHEDULING");
			expect(row.pollStoppedReason).toBeDefined();
			expect(row.nextPollAt).toBeUndefined();
		}
		expect(await claimDueService(NOW)).toBeNull();
	});

	it("keeps polling a row within its timeout that the Hub still calls open", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, {
			createdAt: new Date(NOW.getTime() - HOUR),
		});
		stubJobApi(RUNNING_BODY);
		await pollService(service, TOKEN, NOW);
		const row = await readService(service._id);
		expect(row.pollStoppedReason).toBeUndefined();
		expect(row.nextPollAt).toBeDefined();
	});

	it("still records the end of a job past its timeout", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, {
			createdAt: new Date(NOW.getTime() - 24 * HOUR),
		});
		stubJobApi({ status: { stage: "CANCELED" } });
		const outcome = await pollService(service, TOKEN, NOW);
		expect(outcome).toMatchObject({ stage: "CANCELED", terminal: true });
		const row = await readService(service._id);
		expect(row.pollStoppedReason).toBeUndefined();
		expect(row.endedAt).toEqual(NOW);
	});

	it("gives up after too many failed lookups", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId, { pollFailures: 49 });
		stubJobApi({ offline: true });
		await pollService(service, TOKEN, NOW);
		const row = await readService(service._id);
		expect(row.pollStoppedReason).toMatch(/50/);
		expect(row.nextPollAt).toBeUndefined();
	});
});

describe.sequential("pollDueServices", () => {
	it("polls every due row as the conversation's owner and reports the transitions", async () => {
		const conversationId = await insertConversation();
		const queued = await insertService(conversationId);
		await insertService(conversationId, {
			jobId: OTHER_JOB_ID,
			stage: "RUNNING",
			startedAt: new Date("2026-09-25T11:58:00Z"),
		});
		const fetchMock = stubJobApi(RUNNING_BODY);

		const outcomes = await pollDueServices(NOW);
		expect(outcomes).toHaveLength(2);
		expect(outcomes.filter((o) => o.previousStage !== o.stage).map((o) => o.service.jobId)).toEqual(
			[queued.jobId]
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });

		expect(await pollDueServices(NOW)).toEqual([]);
	});

	it("marks rows whose owner has no live session instead of failing them", async () => {
		const none = await insertConversation({ session: "none" });
		const expired = await insertConversation({ session: "expired" });
		const a = await insertService(none);
		const b = await insertService(expired);
		const fetchMock = stubJobApi(RUNNING_BODY);

		const outcomes = await pollDueServices(NOW);
		expect(outcomes).toHaveLength(2);
		expect(fetchMock).not.toHaveBeenCalled();
		for (const service of [a, b]) {
			const row = await readService(service._id);
			expect(row.stage).toBe("SCHEDULING");
			expect(row.tokenMissingSince).toEqual(NOW);
			expect(row.nextPollAt).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
		}
	});

	it("survives one row's write failing", async () => {
		const conversationId = await insertConversation();
		const service = await insertService(conversationId);
		await insertService(conversationId, { jobId: OTHER_JOB_ID });
		stubJobApi(RUNNING_BODY);
		const updateOne = collections.mlServices.updateOne.bind(collections.mlServices);
		vi.spyOn(collections.mlServices, "updateOne").mockImplementationOnce(async () => {
			throw new Error("write refused");
		});

		const outcomes = await pollDueServices(NOW);
		expect(outcomes).toHaveLength(1);
		collections.mlServices.updateOne = updateOne;
		const rows = await collections.mlServices.find({ conversationId }).toArray();
		expect(rows.filter((r) => r.stage === "RUNNING")).toHaveLength(1);
		// the failed row keeps its lease and is due again after it
		const failed = rows.find((r) => r.stage === "SCHEDULING");
		expect(failed?.nextPollAt).toEqual(new Date(NOW.getTime() + MINUTE));
		expect(service.stage).toBe("SCHEDULING");
	});
});

describe.sequential("store", () => {
	it("makes a new row due at once and leaves the schedule alone on a repeat write", async () => {
		const conversationId = await insertConversation({ session: "none" });
		const dispatched = {
			conversationId,
			kind: "job" as const,
			jobId: JOB_ID,
			namespace: "testuser",
			stage: "SCHEDULING",
		};
		await recordDispatchedService(dispatched);
		const first = await collections.mlServices.findOne({ conversationId, jobId: JOB_ID });
		if (!first) throw new Error("row missing");
		expect(first.nextPollAt).toBeInstanceOf(Date);

		const scheduled = new Date(NOW.getTime() + HOUR);
		await collections.mlServices.updateOne({ _id: first._id }, { $set: { nextPollAt: scheduled } });
		await recordDispatchedService(dispatched);
		expect((await readService(first._id)).nextPollAt).toEqual(scheduled);

		await recordDiscoveredService({
			conversationId,
			kind: "sandbox",
			jobId: SANDBOX_JOB_ID,
			namespace: "testuser",
			handle: sandboxHandle("testuser", SANDBOX_JOB_ID),
		});
		const discovered = await collections.mlServices.findOne({
			conversationId,
			jobId: SANDBOX_JOB_ID,
		});
		expect(discovered?.nextPollAt).toBeInstanceOf(Date);
	});
});
