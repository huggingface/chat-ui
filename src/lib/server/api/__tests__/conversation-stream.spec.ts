import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { collections, ready } from "$lib/server/database";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { createTestConversation, createTestLocals, cleanupTestData } from "./testHelpers";
import { GET } from "../../../../routes/conversation/[id]/stream/+server";

type Frame = { event: string; id?: string; data?: string };

const token = (text: string): MessageUpdate => ({ type: MessageUpdateType.Stream, token: text });

async function startTurn(conversationId: ObjectId, messageId: string): Promise<string> {
	const generationId = randomUUID();
	const now = new Date();
	await collections.generations.insertOne({
		_id: new ObjectId(),
		generationId,
		conversationId,
		messageId,
		status: "running",
		seq: 0,
		lastHeartbeatAt: now,
		startedAt: now,
		createdAt: now,
		updatedAt: now,
	});
	return generationId;
}

async function appendEvents(
	conversationId: ObjectId,
	messageId: string,
	generationId: string,
	fromSeq: number,
	events: MessageUpdate[]
) {
	await collections.generationEvents.insertMany(
		events.map((event, i) => ({
			_id: new ObjectId(),
			generationId,
			conversationId,
			messageId,
			seq: fromSeq + i,
			event,
			createdAt: new Date(),
		}))
	);
}

const endTurn = (generationId: string) =>
	collections.generations.updateOne(
		{ generationId },
		{ $set: { status: "completed", endedAt: new Date() } }
	);

async function openStream(
	locals: App.Locals,
	conversationId: ObjectId,
	query: Record<string, string>
) {
	const url = new URL(`http://localhost/conversation/${conversationId}/stream`);
	for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
	const res = await GET({
		params: { id: conversationId.toString() },
		locals,
		url,
		request: new Request(url),
	} as Parameters<typeof GET>[0]);
	if (!res.body) throw new Error("stream response has no body");

	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	const frames: Frame[] = [];
	const heartbeats: Frame[] = [];
	let text = "";

	/** Read until `count` frames named `event` have arrived (or the stream closes). */
	const readUntil = async (event: string, count = 1): Promise<Frame[]> => {
		const seen = () =>
			event === "heartbeat" ? heartbeats : frames.filter((f) => f.event === event);
		while (seen().length < count) {
			const { done, value } = await reader.read();
			if (done) break;
			text += value;
			const blocks = text.split("\n\n");
			text = blocks.pop() ?? "";
			for (const block of blocks) {
				const frame: Frame = { event: "message" };
				let named = false;
				for (const line of block.split("\n")) {
					if (line.startsWith("event: ")) {
						frame.event = line.slice(7);
						named = true;
					} else if (line.startsWith("id: ")) frame.id = line.slice(4);
					else if (line.startsWith("data:")) frame.data = line.slice(5).trimStart();
				}
				// Heartbeats are idle-tick liveness, interleaved by timing rather than by
				// content, so they are kept apart from the frames whose order is asserted.
				if (frame.event === "heartbeat") heartbeats.push(frame);
				else if (named) frames.push(frame);
			}
		}
		return frames;
	};

	return { frames, heartbeats, readUntil };
}

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await Promise.all([
		cleanupTestData(),
		collections.generations.deleteMany({}),
		collections.generationEvents.deleteMany({}),
		collections.parkedCalls.deleteMany({}),
		collections.turnStates.deleteMany({}),
	]);
});

describe("GET /conversation/[id]/stream", () => {
	it("marks the end of the replayed backlog once, before any live update", async () => {
		const locals = createTestLocals();
		const conv = await createTestConversation(locals);
		const messageId = randomUUID();
		const generationId = await startTurn(conv._id, messageId);
		await appendEvents(conv._id, messageId, generationId, 1, [
			token("already "),
			token("generated "),
			token("text"),
		]);

		const stream = await openStream(locals, conv._id, { messageId, fromSeq: "1" });
		await stream.readUntil("caughtUp");
		expect(stream.frames.map((f) => f.event)).toEqual(["update", "update", "caughtUp"]);
		expect(stream.frames.map((f) => f.id)).toEqual(["2", "3", undefined]);
		// EventSource drops an event with no data field, so the marker must carry one.
		expect(stream.frames.at(-1)?.data).toBe("");

		await appendEvents(conv._id, messageId, generationId, 4, [token(" and live")]);
		await endTurn(generationId);
		await stream.readUntil("end");

		expect(stream.frames.map((f) => f.event)).toEqual([
			"update",
			"update",
			"caughtUp",
			"update",
			"end",
		]);
	});

	it("holds the marker until a reordering gap in the backlog has cleared", async () => {
		const locals = createTestLocals();
		const conv = await createTestConversation(locals);
		const messageId = randomUUID();
		const generationId = await startTurn(conv._id, messageId);
		await appendEvents(conv._id, messageId, generationId, 1, [token("one "), token("two ")]);
		// seq 3 is not visible yet: an unordered multi-document insert in flight.
		await appendEvents(conv._id, messageId, generationId, 4, [token("four "), token("five")]);

		const stream = await openStream(locals, conv._id, { messageId, fromSeq: "0" });
		await stream.readUntil("update", 2);
		await appendEvents(conv._id, messageId, generationId, 3, [token("three ")]);
		await stream.readUntil("caughtUp");

		expect(stream.frames.map((f) => f.id ?? f.event)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"caughtUp",
		]);

		await endTurn(generationId);
		await stream.readUntil("end");
		expect(stream.frames.filter((f) => f.event === "caughtUp")).toHaveLength(1);
	});

	it("does not hold the marker for a hole that stays open", async () => {
		const locals = createTestLocals();
		const conv = await createTestConversation(locals);
		const messageId = randomUUID();
		const generationId = await startTurn(conv._id, messageId);
		await appendEvents(conv._id, messageId, generationId, 1, [token("one "), token("two ")]);
		await appendEvents(conv._id, messageId, generationId, 4, [token("four")]);

		const stream = await openStream(locals, conv._id, { messageId, fromSeq: "0" });
		await stream.readUntil("caughtUp");
		expect(stream.frames.map((f) => f.id ?? f.event)).toEqual(["1", "2", "caughtUp"]);

		await endTurn(generationId);
		await stream.readUntil("end");
		expect(stream.frames.filter((f) => f.event === "caughtUp")).toHaveLength(1);
	});

	it("sends the marker when there is nothing to replay", async () => {
		const locals = createTestLocals();
		const conv = await createTestConversation(locals);
		const messageId = randomUUID();
		const generationId = await startTurn(conv._id, messageId);
		await appendEvents(conv._id, messageId, generationId, 1, [token("materialised")]);

		const stream = await openStream(locals, conv._id, { messageId, fromSeq: "1" });
		await stream.readUntil("caughtUp");
		expect(stream.frames.map((f) => f.event)).toEqual(["caughtUp"]);

		await endTurn(generationId);
		await stream.readUntil("end");
		expect(stream.frames.map((f) => f.event)).toEqual(["caughtUp", "end"]);
	});

	it("sends an idle tick as a named heartbeat that carries data", async () => {
		const locals = createTestLocals();
		const conv = await createTestConversation(locals);
		const messageId = randomUUID();
		const generationId = await startTurn(conv._id, messageId);

		const stream = await openStream(locals, conv._id, { messageId, fromSeq: "0" });
		await stream.readUntil("heartbeat", 2);

		// EventSource drops an event whose data buffer is empty, and a comment never
		// reaches JavaScript at all; either would blind the client's stall watchdog.
		expect(stream.heartbeats.length).toBeGreaterThanOrEqual(2);
		for (const beat of stream.heartbeats) expect(beat.data).toBe("{}");
		// No `id:`, so Last-Event-ID stays on the last update.
		expect(stream.heartbeats.every((beat) => beat.id === undefined)).toBe(true);

		await endTurn(generationId);
		await stream.readUntil("end");
	});
});
