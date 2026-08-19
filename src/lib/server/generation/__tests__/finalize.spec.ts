import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";

import { collections, ready } from "$lib/server/database";
import { markGenerationInterrupted } from "../finalize";

beforeAll(async () => {
	await ready;
});

interface SeedOpts {
	status: "running" | "completed" | "error";
}

async function seed({ status }: SeedOpts) {
	const now = new Date();
	const conversationId = new ObjectId();
	const messageId = randomUUID();
	const generationId = randomUUID();

	await collections.conversations.insertOne({
		_id: conversationId,
		messages: [{ id: messageId, from: "assistant", content: "partial", updates: [] }],
		createdAt: now,
		updatedAt: now,
	} as never);

	await collections.generations.insertOne({
		_id: new ObjectId(),
		generationId,
		conversationId,
		messageId,
		status,
		seq: 3,
		startedAt: now,
		lastHeartbeatAt: now,
		createdAt: now,
		updatedAt: now,
		...(status === "running" ? {} : { endedAt: now }),
	} as never);

	return { conversationId, messageId, generationId };
}

async function messageInterrupted(conversationId: ObjectId, messageId: string): Promise<boolean> {
	const conv = await collections.conversations.findOne({ _id: conversationId });
	const msg = (conv?.messages ?? []).find((m) => m.id === messageId);
	return msg?.interrupted === true;
}

describe.sequential("markGenerationInterrupted", () => {
	afterEach(async () => {
		await Promise.all([
			collections.conversations.deleteMany({}),
			collections.generations.deleteMany({}),
		]);
	});

	it("marks the message when it wins the claim on a running run", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "running" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status).toBe("interrupted");
		expect(await messageInterrupted(conversationId, messageId)).toBe(true);
	});

	// The race the reaper's own status filter cannot prevent: it selects a running run, but
	// the owner pod finishes it before this update lands. The claim must fail closed.
	it("leaves a message untouched when the run already completed", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "completed" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status, "a completed run must not be flipped to interrupted").toBe("completed");
		expect(
			await messageInterrupted(conversationId, messageId),
			"a finished answer must not be flagged stopped"
		).toBe(false);
	});

	it("leaves a message untouched when the run already errored", async () => {
		const { conversationId, messageId, generationId } = await seed({ status: "error" });

		await markGenerationInterrupted(generationId, { conversationId, messageId });

		const gen = await collections.generations.findOne({ generationId });
		expect(gen?.status).toBe("error");
		expect(await messageInterrupted(conversationId, messageId)).toBe(false);
	});
});
