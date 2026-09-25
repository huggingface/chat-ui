import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";
import { readMlBudget } from "./budget";
import { settleHoldFromLookup, settleMlBudget } from "./settle";

beforeAll(async () => {
	await ready;
});

const createdIds: ObjectId[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await collections.conversations.deleteMany({ _id: { $in: createdIds } });
	createdIds.length = 0;
});

async function insertConversation(mlBudget: MlBudget): Promise<ObjectId> {
	const _id = new ObjectId();
	createdIds.push(_id);
	await collections.conversations.insertOne({
		_id,
		title: "settle test",
		model: "test-model",
		messages: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: `settle-test-${_id.toString()}`,
		mlAssistant: true,
		mlBudget,
	});
	return _id;
}

// t4-small at 6667 µUSD/min, 1h timeout: ceiling 400_020.
function traceable(overrides: Partial<MlBudgetReservation> = {}): MlBudgetReservation {
	return {
		key: "gen:call-1",
		kind: "job",
		flavor: "t4-small",
		priceMicroUsdPerMinute: 6667,
		timeoutSeconds: 3600,
		ceilingMicroUsd: 400_020,
		createdAt: new Date(),
		jobId: "0123456789abcdef01234567",
		namespace: "testuser",
		...overrides,
	};
}

function stubJobApi(body: Record<string, unknown> | { notFound: true }) {
	const fetchMock = vi.fn(async () =>
		"notFound" in body
			? { ok: false, status: 404, json: async () => ({}) }
			: { ok: true, status: 200, json: async () => body }
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const budgetWith = (...reservations: MlBudgetReservation[]): MlBudget => ({
	totalMicroUsd: 10_000_000,
	spentMicroUsd: 0,
	reservations,
});

describe.sequential("settleMlBudget", () => {
	it("settles a finished job to its actual minutes", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		stubJobApi({
			status: { stage: "COMPLETED" },
			startedAt: "2026-08-31T10:00:00Z",
			finishedAt: "2026-08-31T10:09:30Z", // 9.5 min → billed 10
		});
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.reservations).toHaveLength(0);
		expect(settled.spentMicroUsd).toBe(6667 * 10);
	});

	it("charges nothing for a job that never started", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		stubJobApi({ status: { stage: "CANCELED" } });
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.spentMicroUsd).toBe(0);
		expect(settled.reservations).toHaveLength(0);
	});

	it("never settles above the ceiling", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable({ ceilingMicroUsd: 10_000 })));
		stubJobApi({
			status: { stage: "COMPLETED" },
			startedAt: "2026-08-31T10:00:00Z",
			finishedAt: "2026-08-31T20:00:00Z",
		});
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.spentMicroUsd).toBe(10_000);
	});

	it("leaves a running job held", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		stubJobApi({ status: { stage: "RUNNING" }, startedAt: "2026-08-31T10:00:00Z" });
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.reservations).toHaveLength(1);
		expect(settled.spentMicroUsd).toBe(0);
	});

	it("charges the ceiling for a job the API no longer knows", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		stubJobApi({ notFound: true });
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.spentMicroUsd).toBe(400_020);
		expect(settled.reservations).toHaveLength(0);
	});

	it("leaves traceable holds alone when there is no token", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		const fetchMock = stubJobApi({ status: { stage: "COMPLETED" } });
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(settled.reservations).toHaveLength(1);
	});

	it("survives the API being down", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetWith(traceable()));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline");
			})
		);
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			token: "hf_test",
		});
		expect(settled.reservations).toHaveLength(1);
	});

	it("eventually charges an untraceable hold at its ceiling", { timeout: 15000 }, async () => {
		const orphan = traceable({ key: "gen:orphan" });
		delete orphan.jobId;
		delete orphan.namespace;
		orphan.createdAt = new Date("2026-08-30T00:00:00Z");
		const young = traceable({ key: "gen:young" });
		delete young.jobId;
		delete young.namespace;
		const id = await insertConversation(budgetWith(orphan, young));
		const settled = await settleMlBudget({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			now: new Date("2026-08-31T00:00:00Z"),
		});
		expect(settled.spentMicroUsd).toBe(400_020);
		expect(settled.reservations.map((r) => r.key)).toEqual(["gen:young"]);
	});
});

describe.sequential("settleHoldFromLookup", () => {
	const completed = {
		state: "terminal" as const,
		billedMinutes: 10,
		job: { stage: "COMPLETED" },
	};

	it("settles the hold with the key, at the minutes already looked up", async () => {
		const id = await insertConversation(budgetWith(traceable(), traceable({ key: "gen:call-2" })));
		const settled = await settleHoldFromLookup({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			reservationKey: "gen:call-1",
			jobId: "0123456789abcdef01234567",
			lookup: completed,
		});
		expect(settled).toBe(true);
		const budget = await readMlBudget(id);
		expect(budget?.reservations.map((r) => r.key)).toEqual(["gen:call-2"]);
		expect(budget?.spentMicroUsd).toBe(6667 * 10);
	});

	it("falls back to the job id and charges the ceiling for a job that is gone", async () => {
		const id = await insertConversation(budgetWith(traceable()));
		const settled = await settleHoldFromLookup({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			jobId: "0123456789abcdef01234567",
			lookup: { state: "gone" },
		});
		expect(settled).toBe(true);
		expect((await readMlBudget(id))?.spentMicroUsd).toBe(400_020);
	});

	it("settles nothing when no hold matches", async () => {
		const id = await insertConversation(budgetWith(traceable()));
		const settled = await settleHoldFromLookup({
			conversationId: id,
			budget: (await readMlBudget(id)) as MlBudget,
			reservationKey: "gen:unknown",
			jobId: "ffffffffffffffffffffffff",
			lookup: completed,
		});
		expect(settled).toBe(false);
		expect((await readMlBudget(id))?.reservations).toHaveLength(1);
	});
});
