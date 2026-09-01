import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { MlBudget, MlBudgetReservation } from "$lib/types/Conversation";
import {
	attachJobToReservation,
	readMlBudget,
	releaseReservation,
	reserveMlBudget,
	setMlBudgetTotal,
	settleReservation,
} from "./budget";

beforeAll(async () => {
	await ready;
});

const createdIds: ObjectId[] = [];

afterEach(async () => {
	await collections.conversations.deleteMany({ _id: { $in: createdIds } });
	createdIds.length = 0;
});

async function insertConversation(mlBudget?: MlBudget): Promise<ObjectId> {
	const _id = new ObjectId();
	createdIds.push(_id);
	await collections.conversations.insertOne({
		_id,
		title: "budget test",
		model: "test-model",
		messages: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: `budget-test-${_id.toString()}`,
		mlAssistant: true,
		...(mlBudget ? { mlBudget } : {}),
	});
	return _id;
}

function reservation(overrides: Partial<MlBudgetReservation> = {}): MlBudgetReservation {
	return {
		key: "gen:call-1",
		kind: "job",
		flavor: "t4-small",
		priceMicroUsdPerMinute: 6667,
		timeoutSeconds: 3600,
		ceilingMicroUsd: 6667 * 60,
		createdAt: new Date(),
		...overrides,
	};
}

const freshBudget = (totalMicroUsd: number): MlBudget => ({
	totalMicroUsd,
	spentMicroUsd: 0,
	reservations: [],
});

describe.sequential("reserveMlBudget", () => {
	it("reserves when the ceiling fits", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		const res = await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 400_000 }),
		});
		expect(res.outcome).toBe("reserved");
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(1);
		expect(budget?.reservations[0].ceilingMicroUsd).toBe(400_000);
	});

	it("counts open holds, not just spend", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ key: "gen:a", ceilingMicroUsd: 700_000 }),
		});
		const res = await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ key: "gen:b", ceilingMicroUsd: 400_000 }),
		});
		expect(res.outcome).toBe("insufficient");
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(1);
	});

	it("counts settled spend", { timeout: 15000 }, async () => {
		const id = await insertConversation({ ...freshBudget(1_000_000), spentMicroUsd: 900_000 });
		const res = await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 200_000 }),
		});
		expect(res.outcome).toBe("insufficient");
	});

	it("is idempotent per key", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 400_000 }),
		});
		const replay = await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 400_000 }),
		});
		expect(replay.outcome).toBe("already_reserved");
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(1);
	});

	it("never conjures a budget onto a conversation without one", { timeout: 15000 }, async () => {
		const id = await insertConversation();
		const res = await reserveMlBudget({ conversationId: id, reservation: reservation() });
		expect(res.outcome).toBe("no_budget");
		expect(await readMlBudget(id)).toBeUndefined();
	});

	it("allows spending the budget exactly to zero", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(400_000));
		const res = await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 400_000 }),
		});
		expect(res.outcome).toBe("reserved");
	});
});

describe.sequential("release / settle", () => {
	it("releases a jobless reservation, once", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		await reserveMlBudget({ conversationId: id, reservation: reservation() });
		expect(await releaseReservation({ conversationId: id, key: "gen:call-1" })).toBe(true);
		expect(await releaseReservation({ conversationId: id, key: "gen:call-1" })).toBe(false);
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(0);
		expect(budget?.spentMicroUsd).toBe(0);
	});

	it("refuses to release once a job is attached", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		await reserveMlBudget({ conversationId: id, reservation: reservation() });
		await attachJobToReservation({
			conversationId: id,
			key: "gen:call-1",
			jobId: "0123456789abcdef01234567",
			namespace: "someone",
		});
		expect(await releaseReservation({ conversationId: id, key: "gen:call-1" })).toBe(false);
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe("0123456789abcdef01234567");
	});

	it("settles to actual cost exactly once", { timeout: 15000 }, async () => {
		const id = await insertConversation(freshBudget(1_000_000));
		await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 400_000 }),
		});
		expect(
			await settleReservation({ conversationId: id, key: "gen:call-1", actualMicroUsd: 66_670 })
		).toBe(true);
		expect(
			await settleReservation({ conversationId: id, key: "gen:call-1", actualMicroUsd: 66_670 })
		).toBe(false);
		const budget = await readMlBudget(id);
		expect(budget?.spentMicroUsd).toBe(66_670);
		expect(budget?.reservations).toHaveLength(0);
	});
});

describe.sequential("setMlBudgetTotal", () => {
	it("creates a budget where none exists", { timeout: 15000 }, async () => {
		const id = await insertConversation();
		expect(await setMlBudgetTotal({ conversationId: id, totalMicroUsd: 5_000_000 })).toBe(true);
		const budget = await readMlBudget(id);
		expect(budget).toEqual({ totalMicroUsd: 5_000_000, spentMicroUsd: 0, reservations: [] });
	});

	it("changes only the total on an existing budget", { timeout: 15000 }, async () => {
		const id = await insertConversation({ ...freshBudget(1_000_000), spentMicroUsd: 250_000 });
		await reserveMlBudget({
			conversationId: id,
			reservation: reservation({ ceilingMicroUsd: 100_000 }),
		});
		await setMlBudgetTotal({ conversationId: id, totalMicroUsd: 9_000_000 });
		const budget = await readMlBudget(id);
		expect(budget?.totalMicroUsd).toBe(9_000_000);
		expect(budget?.spentMicroUsd).toBe(250_000);
		expect(budget?.reservations).toHaveLength(1);
	});

	it("respects the extra filter", { timeout: 15000 }, async () => {
		const id = await insertConversation();
		const matched = await setMlBudgetTotal({
			conversationId: id,
			totalMicroUsd: 5_000_000,
			extraFilter: { mlAssistant: { $ne: true } },
		});
		expect(matched).toBe(false);
		expect(await readMlBudget(id)).toBeUndefined();
	});
});
