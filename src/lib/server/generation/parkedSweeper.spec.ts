import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { sweepParkedCalls } from "./parkedSweeper";
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

	it("gives up on a row that keeps failing to resume", async () => {
		await collections.parkedCalls.insertOne(park({ attempts: 3 }));

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("abandoned");
		expect(row?.abandonedReason).toContain("gave up");
	});
});
