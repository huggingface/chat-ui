import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { waitBuiltin } from "./waitTool";
import type { BuiltinToolContext } from "./types";

const ctx = (over: Partial<BuiltinToolContext> = {}): BuiltinToolContext => ({
	uuid: "uuid-1",
	toolCallId: "call-1",
	conversationId: new ObjectId(),
	messageId: "msg-1",
	userId: new ObjectId(),
	sessionId: "sess-1",
	...over,
});

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.parkedCalls.deleteMany({});
});

describe("the wait tool", () => {
	it("parks the turn and records everything a resume needs", async () => {
		const c = ctx();
		const before = Date.now();

		const outcome = await waitBuiltin.execute({ seconds: 120, reason: "job to finish" }, c);

		expect(outcome).toEqual({ awaitingInput: true });
		const row = await collections.parkedCalls.findOne({});
		expect(row).toMatchObject({
			conversationId: c.conversationId,
			messageId: "msg-1",
			toolCallId: "call-1",
			toolUuid: "uuid-1",
			kind: "timer",
			status: "waiting",
			reason: "job to finish",
			userId: c.userId,
			sessionId: "sess-1",
			attempts: 0,
		});
		// The identity matters as much as the timer: a resume has no request to read
		// one from, and must act as the user who parked.
		expect(row?.resumeAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
	});

	it("clamps a wait to the allowed window rather than refusing it", async () => {
		const waitedFor = async () => {
			const row = await collections.parkedCalls.findOne({});
			if (!row) throw new Error("nothing parked");
			return row.resumeAt.getTime() - row.createdAt.getTime();
		};

		await waitBuiltin.execute({ seconds: 5, reason: "too short" }, ctx());
		expect(await waitedFor()).toBeGreaterThanOrEqual(15_000);

		await collections.parkedCalls.deleteMany({});
		await waitBuiltin.execute({ seconds: 99_999, reason: "too long" }, ctx());
		expect(await waitedFor()).toBeLessThanOrEqual(30 * 60_000);
	});

	it("refuses without saying what it is waiting for", async () => {
		const outcome = await waitBuiltin.execute({ seconds: 60 }, ctx());
		expect(outcome).toHaveProperty("error");
		expect(await collections.parkedCalls.countDocuments({})).toBe(0);
	});

	it("stops a wait-loop from replacing the poll-loop", async () => {
		// Park, resume, park again costs a turn each time and never returns to the
		// user. This is the same ceiling the repetition guard puts on tool calls.
		const conversationId = new ObjectId();
		await collections.parkedCalls.insertMany(
			Array.from({ length: 40 }, () => ({
				_id: new ObjectId(),
				parkedCallId: new ObjectId().toString(),
				conversationId,
				messageId: "m",
				toolCallId: "c",
				toolUuid: "u",
				kind: "timer" as const,
				status: "resumed" as const,
				resumeAt: new Date(),
				reason: "prior hop",
				attempts: 1,
				createdAt: new Date(),
				updatedAt: new Date(),
			}))
		);

		const outcome = await waitBuiltin.execute(
			{ seconds: 60, reason: "again" },
			ctx({ conversationId })
		);

		expect(outcome).toHaveProperty("error");
		expect(String((outcome as { error: string }).error)).toContain("limit");
		expect(await collections.parkedCalls.countDocuments({ conversationId })).toBe(40);
	});

	it("declines to park where nothing could wake it", async () => {
		const outcome = await waitBuiltin.execute(
			{ seconds: 60, reason: "x" },
			ctx({ conversationId: undefined })
		);
		expect(outcome).toHaveProperty("error");
		expect(await collections.parkedCalls.countDocuments({})).toBe(0);
	});
});
