import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { z } from "zod";

const { FAKE_MODELS } = vi.hoisted(() => ({
	FAKE_MODELS: [{ id: "test-model", name: "test-model", unlisted: false, preprompt: "" }],
}));

vi.mock("$lib/server/models", () => ({
	models: FAKE_MODELS,
	validateModel: () => z.string(),
	validModelIdSchema: z.string(),
}));
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));

import { collections, ready } from "$lib/server/database";
import { createTestConversation, createTestUser } from "$lib/server/api/__tests__/testHelpers";
import { generateConversationResponse } from "$lib/server/generation/conversationRequest";
import { claimTurnStart } from "$lib/server/queuedInputs/drain";

const ROOT = "11111111-1111-4111-8111-111111111111";
const U1 = "22222222-2222-4222-8222-222222222222";
const A1 = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
	await ready;
	// the turn start lock relies on it, and a fresh test database builds it in the background
	await collections.semaphores.createIndex({ key: 1 }, { unique: true });
});

// cleanupTestData empties shared collections under specs running in parallel
const created: ObjectId[] = [];
const users: ObjectId[] = [];

async function busyConversation() {
	const { locals, user } = await createTestUser();
	users.push(user._id);
	const now = new Date();
	const conversation = await createTestConversation(locals, {
		mlAssistant: true,
		rootMessageId: ROOT,
		messages: [
			{ id: ROOT, from: "system", content: "", children: [U1], createdAt: now, updatedAt: now },
			{
				id: U1,
				from: "user",
				content: "train it",
				ancestors: [ROOT],
				children: [A1],
				createdAt: now,
				updatedAt: now,
			},
			{
				id: A1,
				from: "assistant",
				content: "",
				ancestors: [ROOT, U1],
				children: [],
				createdAt: now,
				updatedAt: now,
			},
		],
	} as never);
	created.push(conversation._id);
	return { locals, conversationId: conversation._id };
}

function send(locals: App.Locals, conversationId: ObjectId) {
	const data = new FormData();
	data.set(
		"data",
		JSON.stringify({ inputs: "also try lr 1e-4", id: A1, generationId: crypto.randomUUID() })
	);
	return generateConversationResponse({
		request: new Request("http://localhost/conversation", { method: "POST", body: data }),
		locals,
		params: { id: conversationId.toString() },
		getClientAddress: () => "127.0.0.1",
	});
}

describe.sequential("a normal send into a busy ML Intern conversation", () => {
	afterEach(async () => {
		await collections.generations.deleteMany({ messageId: A1 });
		await collections.semaphores.deleteMany({
			key: { $in: created.map((id) => `queue.drain:${id.toString()}`) },
		});
		await collections.conversations.deleteMany({ _id: { $in: created } });
		await collections.users.deleteMany({ _id: { $in: users } });
		await collections.sessions.deleteMany({ userId: { $in: users } });
		created.length = 0;
		users.length = 0;
	});

	it("is refused while the latest turn runs, and leaves the messages alone", async () => {
		const { locals, conversationId } = await busyConversation();
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: "g",
			conversationId,
			messageId: A1,
			status: "running",
			startedAt: new Date(),
			lastHeartbeatAt: new Date(),
		} as never);

		await expect(send(locals, conversationId)).rejects.toMatchObject({ status: 409 });
		const stored = await collections.conversations.findOne({ _id: conversationId });
		expect(stored?.messages).toHaveLength(3);
		await collections.generations.deleteMany({ conversationId });
		const free = await claimTurnStart(conversationId, "alive");
		expect(free).toBeDefined();
		await free?.release();
	});

	it("lets go of the turn start when saving the new messages fails", async () => {
		const { locals, conversationId } = await busyConversation();
		const updateOne = collections.conversations.updateOne.bind(collections.conversations);
		const spy = vi
			.spyOn(collections.conversations, "updateOne")
			.mockImplementation(((filter: never, update: { $set?: Record<string, unknown> }) =>
				update.$set && "messages" in update.$set
					? Promise.reject(new Error("write failed"))
					: updateOne(filter, update as never)) as never);

		await expect(send(locals, conversationId)).rejects.toThrow("write failed");
		spy.mockRestore();
		const next = await claimTurnStart(conversationId, "alive");
		expect(next).toBeDefined();
		await next?.release();
	});

	it("is refused while a start from the queue holds the conversation", async () => {
		const { locals, conversationId } = await busyConversation();
		const release = await claimTurnStart(conversationId, "alive");

		await expect(send(locals, conversationId)).rejects.toMatchObject({ status: 409 });
		await release?.release();
	});
});
