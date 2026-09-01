import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { renewClaim, sweepParkedCalls, wakeParkedCallEarly } from "./parkedSweeper";
import type { ParkedCall } from "$lib/types/ParkedCall";

const park = (over: Partial<ParkedCall> = {}): ParkedCall => ({
	_id: new ObjectId(),
	parkedCallId: new ObjectId().toString(),
	conversationId: new ObjectId(),
	messageId: "msg-1",
	toolCallId: "call-1",
	toolUuid: "uuid-1",
	kind: "timer",
	status: "waiting",
	// Due unless a test says otherwise.
	resumeAt: new Date(Date.now() - 1_000),
	reason: "training job to reach step 1000",
	attempts: 0,
	createdAt: new Date(Date.now() - 60_000),
	updatedAt: new Date(Date.now() - 60_000),
	...over,
});

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.parkedCalls.deleteMany({});
	await collections.turnStates.deleteMany({});
	await collections.conversations.deleteMany({ title: "abandoned turn" });
});

describe("sweepParkedCalls", () => {
	it("leaves a row alone until its timer is due", async () => {
		await collections.parkedCalls.insertOne(park({ resumeAt: new Date(Date.now() + 60_000) }));

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("waiting");
		expect(row?.attempts).toBe(0);
	});

	it("abandons a due row whose conversation is gone, instead of retrying forever", async () => {
		// The conversation id points at nothing, which is the shape of a deleted chat.
		await collections.parkedCalls.insertOne(park());

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("abandoned");
		expect(row?.abandonedReason).toBe("conversation is gone");
	});

	it("claims each due row exactly once", async () => {
		// The claim is what stops two pods waking the same turn: the status is in the
		// filter, so a racing sweep finds the row already out of `waiting`.
		await collections.parkedCalls.insertMany([park(), park(), park()]);

		await Promise.all([sweepParkedCalls(), sweepParkedCalls()]);

		const rows = await collections.parkedCalls.find({}).toArray();
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.status === "abandoned")).toBe(true);
		// One claim each. A second claim would have incremented past 1.
		expect(rows.map((r) => r.attempts)).toEqual([1, 1, 1]);
	});

	it("reclaims a claim whose lease expired", async () => {
		// A resume that dies before its own error handling — or a pod that dies at
		// any point — leaves the row in `resuming`. Without a lease it sits there
		// until the TTL removes it, and the attempt ceiling never applies.
		await collections.parkedCalls.insertOne(
			park({ status: "resuming", takenAt: new Date(Date.now() - 10 * 60_000), attempts: 1 })
		);

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.attempts).toBe(2);
		expect(row?.status).toBe("abandoned");
	});

	it("leaves a claim alone while its lease holds", async () => {
		// Otherwise two sweepers a few seconds apart both resume the same turn.
		await collections.parkedCalls.insertOne(
			park({ status: "resuming", takenAt: new Date(), attempts: 1 })
		);

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("resuming");
		expect(row?.attempts).toBe(1);
	});

	it("gives up on a row that keeps failing to resume", async () => {
		await collections.parkedCalls.insertOne(park({ attempts: 3 }));

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("abandoned");
		expect(row?.abandonedReason).toContain("gave up");
	});

	it("abandonment closes the turn: state fails, and the message reads terminal", async () => {
		// An abandoned park used to leave the state doc `waiting`: the turn read
		// alive forever, subscriptions churned on heartbeats, and the client sat
		// on an "overdue" banner for a wake that could not come.
		const row = park({ attempts: 3 });
		await collections.conversations.insertOne({
			_id: row.conversationId,
			sessionId: "s",
			model: "test-org/test-model",
			title: "abandoned turn",
			rootMessageId: "u1",
			messages: [
				{ id: "u1", from: "user", content: "go", ancestors: [], children: [row.messageId] },
				{
					id: row.messageId,
					from: "assistant",
					content: "",
					updates: [],
					ancestors: ["u1"],
					children: [],
				},
			],
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId: row.conversationId,
			messageId: row.messageId,
			producerId: "gen-old",
			status: "waiting",
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		await collections.parkedCalls.insertOne(row);

		await sweepParkedCalls();

		expect((await collections.parkedCalls.findOne({}))?.status).toBe("abandoned");
		const state = await collections.turnStates.findOne({ conversationId: row.conversationId });
		expect(state?.status).toBe("failed");
		expect(state?.error).toContain("abandoned");
		// Persisted into the message, with no producer to emit it: the next
		// snapshot reads terminal — the banner clears and Resume is on offer.
		const conv = await collections.conversations.findOne({ _id: row.conversationId });
		const message = conv?.messages.find((m) => m.id === row.messageId);
		expect(message?.updates?.at(-1)).toMatchObject({ type: "turnState", state: "failed" });
	});
});

describe("renewClaim", () => {
	it("keeps a live resume's row from being stolen when its original lease ages out", async () => {
		// A resumed ML turn routinely runs longer than the claim lease. The live
		// resume renews; without the renewal the sweeper would re-claim the row
		// and launch a SECOND producer onto the same turn — dueling writers,
		// interleaved turn states (the stuck wait banner), an abandon mid-run.
		const row = park({
			status: "resuming",
			takenAt: new Date(Date.now() - 10 * 60_000),
			attempts: 1,
		});
		await collections.parkedCalls.insertOne(row);

		await renewClaim(row);
		await sweepParkedCalls();

		const after = await collections.parkedCalls.findOne({});
		expect(after?.status).toBe("resuming");
		expect(after?.attempts).toBe(1);
	});

	it("never revives a row whose resume already finished", async () => {
		const takenAt = new Date(Date.now() - 60_000);
		const row = park({ status: "resumed", takenAt, attempts: 1 });
		await collections.parkedCalls.insertOne(row);

		await renewClaim(row);

		const after = await collections.parkedCalls.findOne({});
		expect(after?.status).toBe("resumed");
		expect(after?.takenAt?.getTime()).toBe(takenAt.getTime());
	});
});

describe("wakeParkedCallEarly", () => {
	it("makes a waiting row due now and records that the user cut the wait short", async () => {
		const row = park({ resumeAt: new Date(Date.now() + 10 * 60_000) });
		await collections.parkedCalls.insertOne(row);

		const woken = await wakeParkedCallEarly(row.conversationId, row.messageId);

		expect(woken).toBe(true);
		const after = await collections.parkedCalls.findOne({});
		// Still `waiting`: the ordinary claim decides who resumes it, so an early
		// wake can never race a sweeper into two producers for one turn.
		expect(after?.status).toBe("waiting");
		expect(after?.resumeAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(after?.wokeEarlyAt).toBeInstanceOf(Date);
	});

	it("only touches the turn it was asked about", async () => {
		const mine = park({ resumeAt: new Date(Date.now() + 10 * 60_000) });
		const other = park({ messageId: "msg-2", resumeAt: new Date(Date.now() + 10 * 60_000) });
		await collections.parkedCalls.insertMany([mine, other]);

		await wakeParkedCallEarly(mine.conversationId, mine.messageId);

		const untouched = await collections.parkedCalls.findOne({ messageId: "msg-2" });
		expect(untouched?.resumeAt.getTime()).toBe(other.resumeAt.getTime());
		expect(untouched?.wokeEarlyAt).toBeUndefined();
	});

	it("reports no wake when the turn is not parked on a timer", async () => {
		const row = park({ status: "resuming" });
		await collections.parkedCalls.insertOne(row);

		expect(await wakeParkedCallEarly(row.conversationId, row.messageId)).toBe(false);
	});
});
