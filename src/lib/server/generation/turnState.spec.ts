/**
 * The P1 turn-state guarantee: every lifecycle transition updates the
 * authoritative state document AND lands in the turn log as an in-band event,
 * so a subscriber sees waiting → resumed → waiting → resumed → done on the
 * same channel as the rest of the turn, and a snapshot reader gets the same
 * truth from the document. The terminal write is a CAS that cannot clobber a
 * park recorded mid-run.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { collections, ready } from "$lib/server/database";
import { createGenerationWriter } from "./writer";
import { turnAwaitingInput, turnEnded, turnRunning, turnWaiting } from "./turnState";
import { turnEventsAfter } from "./turnLog";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";

const token = (text: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token: text });

async function makeWriter(conversationId: ObjectId, messageId: string, producerId: string) {
	return createGenerationWriter({
		generationId: producerId,
		conversationId,
		messageId,
		snapshot: () => ({ content: "" }),
	});
}

async function stateDoc(conversationId: ObjectId, messageId: string) {
	return collections.turnStates.findOne({ conversationId, messageId });
}

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await collections.generationEvents.deleteMany({});
	await collections.generations.deleteMany({});
	await collections.turnStates.deleteMany({});
});

describe("turn state transitions", () => {
	it("carries a two-wait turn's lifecycle in-band, with the document matching at every step", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();
		const key = (producerId: string) => ({ conversationId, messageId, producerId });

		// Producer 1: runs, then parks on a wait.
		const p1 = randomUUID();
		const first = await makeWriter(conversationId, messageId, p1);
		first.push(await turnRunning(key(p1)));
		first.push(token("first stretch"));
		const untilOne = new Date(Date.now() + 60_000);
		first.push(await turnWaiting(key(p1), { until: untilOne, reason: "job one" }));
		// The producer's own wind-down cannot clobber the park it recorded.
		expect(await turnEnded(key(p1), { failed: false })).toBeNull();
		await first.finish({ status: "completed" });

		let doc = await stateDoc(conversationId, messageId);
		expect(doc).toMatchObject({ status: "waiting", producerId: p1, waitReason: "job one" });
		expect(doc?.waitUntil?.getTime()).toBe(untilOne.getTime());

		// Producer 2: the first resume — runs, parks again.
		const p2 = randomUUID();
		const second = await makeWriter(conversationId, messageId, p2);
		second.push(await turnRunning(key(p2)));
		second.push(token("second stretch"));
		const untilTwo = new Date(Date.now() + 120_000);
		second.push(await turnWaiting(key(p2), { until: untilTwo, reason: "job two" }));
		await second.finish({ status: "completed" });

		doc = await stateDoc(conversationId, messageId);
		expect(doc).toMatchObject({ status: "waiting", producerId: p2, waitReason: "job two" });

		// Producer 3: the second resume — runs to completion.
		const p3 = randomUUID();
		const third = await makeWriter(conversationId, messageId, p3);
		third.push(await turnRunning(key(p3)));
		third.push(token("the answer"));
		const ended = await turnEnded(key(p3), { failed: false });
		expect(ended).not.toBeNull();
		if (ended) third.push(ended);
		await third.finish({ status: "completed" });

		doc = await stateDoc(conversationId, messageId);
		expect(doc?.status).toBe("done");
		expect(doc?.endedAt).toBeInstanceOf(Date);
		expect(doc?.waitUntil).toBeUndefined();

		// The whole lifecycle reads in-band, in order, on one contiguous log.
		const events = await turnEventsAfter(conversationId, messageId, 0, 100);
		expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
		const states = events.map((e) => e.event).filter((u) => u.type === MessageUpdateType.TurnState);
		expect(states.map((u) => (u.type === MessageUpdateType.TurnState ? u.state : ""))).toEqual([
			"running",
			"waiting",
			"running",
			"waiting",
			"running",
			"done",
		]);
		// Waiting events carry the absolute deadline and the skew reference.
		const waits = states.filter(
			(u) => u.type === MessageUpdateType.TurnState && u.state === "waiting"
		);
		for (const wait of waits) {
			if (wait.type !== MessageUpdateType.TurnState) continue;
			expect(wait.until).toBeGreaterThan(wait.serverNow);
			expect(wait.reason).toBeTruthy();
		}
	});

	it("records a shown question as awaiting_input, which the producer's wind-down leaves standing", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();
		const producerId = randomUUID();
		const key = { conversationId, messageId, producerId };

		await turnRunning(key);
		const update = await turnAwaitingInput(key);
		expect(update.state).toBe("awaiting_input");
		expect(await turnEnded(key, { failed: false })).toBeNull();
		expect((await stateDoc(conversationId, messageId))?.status).toBe("awaiting_input");
	});

	it("records a failed turn with its error", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();
		const producerId = randomUUID();
		const key = { conversationId, messageId, producerId };

		await turnRunning(key);
		const ended = await turnEnded(key, { failed: true, error: "boom" });
		expect(ended).toMatchObject({ state: "failed", error: "boom" });
		expect(await stateDoc(conversationId, messageId)).toMatchObject({
			status: "failed",
			error: "boom",
		});
	});

	it("only the holding producer may end the turn", async () => {
		const conversationId = new ObjectId();
		const messageId = randomUUID();
		const holder = randomUUID();

		await turnRunning({ conversationId, messageId, producerId: holder });
		// A stale producer (e.g. a superseded run) cannot end a turn it no longer holds.
		expect(
			await turnEnded({ conversationId, messageId, producerId: randomUUID() }, { failed: false })
		).toBeNull();
		expect((await stateDoc(conversationId, messageId))?.status).toBe("running");
	});
});
