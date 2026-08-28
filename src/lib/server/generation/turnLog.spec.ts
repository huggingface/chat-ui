/**
 * The P0 turn-continuity guarantee, proven against the real persistence path:
 * one turn's event log is a single contiguous sequence across every producer
 * that works on it, so a subscriber holding (messageId, fromSeq) — connected
 * before a park, or joining at any moment — receives the resumed producer's
 * events on the same cursor, with nothing to discover and nothing replayed
 * twice. Everything between the writer API and MongoDB is real; only the
 * producers are scripted.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { collections, ready } from "$lib/server/database";
import { createGenerationWriter } from "./writer";
import { createGapTracker, isTurnAlive, turnEventsAfter } from "./turnLog";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";

const token = (text: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token: text });

// The writer coalesces consecutive same-kind stream tokens into one event, so
// producers in these tests alternate stream and tool events to pin exact counts.
const toolCall = (name: string): MessageUpdate =>
	({
		type: MessageUpdateType.Tool,
		subtype: "call",
		uuid: randomUUID(),
		call: { name, parameters: {} },
	}) as MessageUpdate;

async function makeWriter(conversationId: ObjectId, messageId: string, continueFromSeq?: number) {
	return createGenerationWriter({
		generationId: randomUUID(),
		conversationId,
		messageId,
		...(continueFromSeq !== undefined ? { continueFromSeq } : {}),
		snapshot: () => ({ content: "" }),
	});
}

function parkedRow(conversationId: ObjectId, messageId: string, status: "waiting" | "resuming") {
	const now = new Date();
	return {
		_id: new ObjectId(),
		parkedCallId: randomUUID(),
		conversationId,
		messageId,
		toolCallId: "call_1",
		toolUuid: randomUUID(),
		kind: "timer" as const,
		status,
		resumeAt: new Date(now.getTime() + 60_000),
		reason: "test wait",
		attempts: 0,
		createdAt: now,
		updatedAt: now,
	};
}

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.generationEvents.deleteMany({});
	await collections.generations.deleteMany({});
	await collections.parkedCalls.deleteMany({});
	await collections.turnStates.deleteMany({});
});

describe("the turn-scoped event log", () => {
	it("continues one contiguous sequence across producers, so a fixed cursor spans a park/resume", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();

		// Producer 1: the HTTP run. Alternating kinds → four distinct events.
		const first = await makeWriter(conversationId, messageId);
		first.push(token("hello "));
		first.push(toolCall("hf_fs"));
		first.push(token("world"));
		first.push(toolCall("wait"));
		await first.finish({ status: "completed" });

		// The subscriber drains up to the park and holds its cursor.
		const beforePark = await turnEventsAfter(conversationId, messageId, 0, 100);
		expect(beforePark.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
		const cursor = beforePark.at(-1)?.seq ?? 0;

		// The park: no producer running, a row waiting for its deadline.
		await collections.parkedCalls.insertOne(parkedRow(conversationId, messageId, "waiting"));
		expect(await isTurnAlive(conversationId, messageId)).toEqual({
			alive: true,
			status: "parked",
		});

		// The claim window: the sweeper took the row, no producer registered yet.
		await collections.parkedCalls.updateOne({ conversationId }, { $set: { status: "resuming" } });
		expect(await isTurnAlive(conversationId, messageId)).toEqual({
			alive: true,
			status: "parked",
		});

		// Producer 2: the resumed run — a new generationId, the same turn.
		const resumed = await makeWriter(conversationId, messageId);
		expect(await isTurnAlive(conversationId, messageId)).toEqual({
			alive: true,
			status: "running",
		});
		resumed.push(toolCall("hf_jobs"));
		resumed.push(token("resumed output"));
		await resumed.finish({ status: "completed" });
		await collections.parkedCalls.updateOne({ conversationId }, { $set: { status: "resumed" } });

		// The held cursor picks up the resumed producer's events — same key,
		// contiguous numbering, no duplicates, nothing to rediscover.
		const afterResume = await turnEventsAfter(conversationId, messageId, cursor, 100);
		expect(afterResume.map((e) => e.seq)).toEqual([5, 6]);
		expect(afterResume.map((e) => e.generationId)).not.toContain(beforePark[0]?.generationId ?? "");

		// And the turn now reads over, with the last producer's status.
		expect(await isTurnAlive(conversationId, messageId)).toEqual({
			alive: false,
			status: "completed",
		});
	});

	it("floors the sequence at continueFromSeq for turns whose earlier events predate the turn key", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();

		const writer = await makeWriter(conversationId, messageId, 328);
		writer.push(token("continued"));
		await writer.finish({ status: "completed" });

		const events = await turnEventsAfter(conversationId, messageId, 0, 10);
		expect(events.map((e) => e.seq)).toEqual([329]);
		// A client cursor from the pre-turn-scoped era stays meaningful.
		expect(await turnEventsAfter(conversationId, messageId, 328, 10)).toHaveLength(1);
	});

	it("keeps a turn awaiting the user's answer alive, so subscriptions span questions", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();

		const writer = await makeWriter(conversationId, messageId);
		writer.push(token("asked something"));
		await writer.finish({ status: "completed" });
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId,
			messageId,
			status: "awaiting_input",
			producerId: randomUUID(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		expect(await isTurnAlive(conversationId, messageId)).toEqual({
			alive: true,
			status: "awaiting_input",
		});
	});

	it("reports an unknown turn as gone", async () => {
		expect(await isTurnAlive(new ObjectId(), randomUUID())).toEqual({
			alive: false,
			status: "gone",
		});
	});

	it("keeps per-producer event numbering unique for the audit index", async () => {
		// The legacy unique index (generationId, seq) must survive turn scoping:
		// each producer's events are a contiguous subrange of the turn sequence,
		// so uniqueness holds per producer even though numbering starts past 1.
		const conversationId = new ObjectId();
		const messageId = randomUUID();

		const a = await makeWriter(conversationId, messageId);
		a.push(token("one"));
		await a.finish({ status: "completed" });
		const b = await makeWriter(conversationId, messageId);
		b.push(token("two"));
		await b.finish({ status: "completed" });

		const events = await turnEventsAfter(conversationId, messageId, 0, 10);
		expect(events.map((e) => e.seq)).toEqual([1, 2]);
		expect(new Set(events.map((e) => e.generationId)).size).toBe(2);
	});
});

describe("createGapTracker", () => {
	it("holds a fresh gap (insert reordering) and releases only past tolerance", () => {
		let t = 0;
		const gap = createGapTracker(10_000, () => t);
		expect(gap.blockedAt(5)).toBe(false); // first sighting: wait for the insert
		t = 9_000;
		expect(gap.blockedAt(5)).toBe(false); // still within tolerance
		t = 11_000;
		expect(gap.blockedAt(5)).toBe(true); // a hole: the reader must skip or starve
	});

	it("restarts the clock when the blocking sequence changes", () => {
		let t = 0;
		const gap = createGapTracker(10_000, () => t);
		expect(gap.blockedAt(5)).toBe(false);
		t = 11_000;
		expect(gap.blockedAt(7)).toBe(false); // the hole moved: fresh sighting
		t = 22_000;
		expect(gap.blockedAt(7)).toBe(true);
	});

	it("clears on progress so a later gap gets its own full tolerance", () => {
		let t = 0;
		const gap = createGapTracker(10_000, () => t);
		expect(gap.blockedAt(5)).toBe(false);
		gap.advanced(); // the missing event arrived and was delivered
		t = 60_000;
		expect(gap.blockedAt(5)).toBe(false); // same seq, but a brand-new sighting
	});
});
