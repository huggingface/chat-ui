import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";
import { readMlBudget } from "./budget";
import { listLabelledJobs, settleHoldFromLookup, settleMlBudget } from "./settle";

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

describe("listLabelledJobs", () => {
	const JOB = (id: string, stage: string, labels: Record<string, unknown> = {}) => ({
		id,
		createdAt: "2026-09-25T11:00:00.000Z",
		status: { stage, message: null },
		owner: { id: "u1", name: "acme", type: "org" },
		flavor: "t4-small",
		labels,
		timeout_seconds: 3600,
	});

	function stubPages(pages: { body: unknown; link?: string; status?: number }[]) {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
			const page = pages.shift();
			if (!page) throw new Error("no more pages");
			return {
				ok: (page.status ?? 200) < 400,
				status: page.status ?? 200,
				headers: new Headers(page.link ? { link: page.link } : {}),
				json: async () => page.body,
			};
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("asks the hub to filter by every label and follows the pages", async () => {
		const next = "https://huggingface.co/api/jobs/acme?label=ml-intern-session%3Dabc&cursor=2";
		const fetchMock = stubPages([
			{
				body: [JOB("0123456789abcdef01234567", "RUNNING", { name: "ml-intern-a", n: 1 })],
				link: `<${next}>; rel="next"`,
			},
			{ body: [JOB("fedcbafedcbafedcbafedcba", "COMPLETED"), { id: "not-a-job" }] },
		]);

		const jobs = await listLabelledJobs({
			namespace: "acme",
			labels: { "ml-intern-session": "abc" },
			token: "hf_test",
		});

		const [firstUrl, init] = fetchMock.mock.calls[0];
		expect(String(firstUrl)).toBe(
			"https://huggingface.co/api/jobs/acme?label=ml-intern-session%3Dabc"
		);
		expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer hf_test");
		expect(String(fetchMock.mock.calls[1][0])).toBe(next);
		expect(jobs).toEqual([
			{
				jobId: "0123456789abcdef01234567",
				stage: "RUNNING",
				flavor: "t4-small",
				timeoutSeconds: 3600,
				createdAt: new Date("2026-09-25T11:00:00.000Z"),
				labels: { name: "ml-intern-a" },
			},
			{
				jobId: "fedcbafedcbafedcbafedcba",
				stage: "COMPLETED",
				flavor: "t4-small",
				timeoutSeconds: 3600,
				createdAt: new Date("2026-09-25T11:00:00.000Z"),
				labels: {},
			},
		]);
	});

	it("does not send the token to a next page off the hub", async () => {
		const fetchMock = stubPages([
			{
				body: [JOB("0123456789abcdef01234567", "RUNNING")],
				link: '<https://elsewhere.example/api/jobs/acme?cursor=2>; rel="next"',
			},
		]);
		const jobs = await listLabelledJobs({ namespace: "acme", labels: { k: "v" }, token: "t" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(jobs).toHaveLength(1);
	});

	it("is undefined when any page cannot be read", async () => {
		stubPages([
			{
				body: [JOB("0123456789abcdef01234567", "RUNNING")],
				link: '</api/jobs/acme?c=2>; rel="next"',
			},
			{ body: {}, status: 500 },
		]);
		expect(
			await listLabelledJobs({ namespace: "acme", labels: { k: "v" }, token: "t" })
		).toBeUndefined();
		stubPages([{ body: { error: "not a list" } }]);
		expect(
			await listLabelledJobs({ namespace: "acme", labels: { k: "v" }, token: "t" })
		).toBeUndefined();
	});
});
