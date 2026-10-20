import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

import { collections, ready } from "$lib/server/database";
import {
	createTestConversation,
	createTestUser as createUser,
} from "$lib/server/api/__tests__/testHelpers";
import { claimQueuedInputs, queuedInputCharLimit } from "$lib/server/queuedInputs/store";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
const kick = vi.hoisted(() => vi.fn());
vi.mock("$lib/server/queuedInputs/drain", () => ({ kickQueuedTurn: kick }));

const { GET, POST, DELETE } = await import("../../../routes/conversation/[id]/queue/+server");
const { POST: STOP } = await import("../../../routes/conversation/[id]/stop-generating/+server");
const { POST: INTERRUPT } =
	await import("../../../routes/conversation/[id]/queue/interrupt/+server");

beforeAll(async () => {
	await ready;
});

// cleanupTestData empties shared collections under specs running in parallel
const userIds: ObjectId[] = [];
async function createTestUser() {
	const created = await createUser();
	userIds.push(created.user._id);
	return created;
}

const call = (
	handler: (event: never) => Response | Promise<Response>,
	id: string,
	locals: App.Locals,
	method: string,
	body?: unknown
) =>
	Promise.resolve().then(() =>
		handler({
			params: { id },
			locals,
			request: new Request("http://localhost/queue", {
				method,
				headers: { "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			}),
		} as never)
	);

describe.sequential("/conversation/[id]/queue", () => {
	afterEach(async () => {
		kick.mockReset();
		const conversations = await collections.conversations
			.find({ userId: { $in: userIds } }, { projection: { _id: 1 } })
			.toArray();
		const conversationIds = conversations.map(({ _id }) => _id);
		await Promise.all([
			collections.queuedInputs.deleteMany({ conversationId: { $in: conversationIds } }),
			collections.abortedGenerations.deleteMany({ conversationId: { $in: conversationIds } }),
			collections.conversations.deleteMany({ _id: { $in: conversationIds } }),
			collections.sessions.deleteMany({ userId: { $in: userIds } }),
			collections.users.deleteMany({ _id: { $in: userIds } }),
		]);
		userIds.length = 0;
	});

	async function mlConversation() {
		const { locals } = await createTestUser();
		const conversation = await createTestConversation(locals, { mlAssistant: true });
		return { locals, id: conversation._id.toString(), conversationId: conversation._id };
	}

	it("queues a message, kicks the drain and lists it", async () => {
		const { locals, id } = await mlConversation();

		const response = await call(POST, id, locals, "POST", { text: "use lr 1e-4" });
		expect(response.status).toBe(200);
		const { input } = await response.json();
		expect(input).toMatchObject({ text: "use lr 1e-4", status: "queued" });
		expect(kick).toHaveBeenCalledTimes(1);

		const listed = await (await call(GET, id, locals, "GET")).json();
		expect(listed.inputs.map((row: { id: string }) => row.id)).toEqual([input.id]);
	});

	it("refuses anyone but the owner, and conversations outside ML Intern", async () => {
		const { id } = await mlConversation();
		const { locals: stranger } = await createTestUser();
		await expect(call(POST, id, stranger, "POST", { text: "hi" })).rejects.toMatchObject({
			status: 404,
		});
		await expect(call(POST, id, {} as App.Locals, "POST", { text: "hi" })).rejects.toMatchObject({
			status: 401,
		});

		const { locals } = await createTestUser();
		const plain = await createTestConversation(locals);
		await expect(
			call(POST, plain._id.toString(), locals, "POST", { text: "hi" })
		).rejects.toMatchObject({ status: 400 });
	});

	it("rejects an empty, an oversized and an eleventh message", async () => {
		const { locals, id } = await mlConversation();
		await expect(call(POST, id, locals, "POST", { text: "  " })).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			call(POST, id, locals, "POST", { text: "x".repeat(queuedInputCharLimit() + 1) })
		).rejects.toMatchObject({ status: 413 });
		for (let i = 0; i < 10; i += 1) await call(POST, id, locals, "POST", { text: `m${i}` });
		await expect(call(POST, id, locals, "POST", { text: "one more" })).rejects.toMatchObject({
			status: 429,
		});
	});

	it("cancels a queued message and answers 409 once a turn took it", async () => {
		const { locals, id, conversationId } = await mlConversation();
		const first = (await (await call(POST, id, locals, "POST", { text: "a" })).json()).input;
		expect((await call(DELETE, id, locals, "DELETE", { id: first.id })).status).toBe(200);

		const second = (await (await call(POST, id, locals, "POST", { text: "b" })).json()).input;
		await claimQueuedInputs(conversationId, { status: "delivered", messageId: "m" });
		const lost = await call(DELETE, id, locals, "DELETE", { id: second.id });
		expect(lost.status).toBe(409);
		expect(await lost.json()).toEqual({ cancelled: false });
	});

	it("has the stop report which queued messages it cancelled", async () => {
		const { locals, id, conversationId } = await mlConversation();
		const taken = (await (await call(POST, id, locals, "POST", { text: "taken" })).json()).input;
		await claimQueuedInputs(conversationId, { status: "started" });
		const left = (await (await call(POST, id, locals, "POST", { text: "left" })).json()).input;

		const response = await STOP({ params: { id }, locals } as never);
		expect(await response.json()).toEqual({ cancelledQueuedInputs: [left.id] });
		expect(taken.id).not.toBe(left.id);
	});

	it("send now stops a running step and keeps the queue for the next turn", async () => {
		const { locals, id, conversationId } = await mlConversation();
		await expect(call(INTERRUPT, id, locals, "POST")).rejects.toMatchObject({ status: 409 });

		await call(POST, id, locals, "POST", { text: "do this instead" });
		const messageId = crypto.randomUUID();
		await collections.conversations.updateOne({ _id: conversationId }, {
			$push: {
				messages: {
					id: messageId,
					from: "assistant",
					content: "",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			},
		} as never);
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: "g",
			conversationId,
			messageId,
			status: "running",
			startedAt: new Date(),
			lastHeartbeatAt: new Date(),
		} as never);
		kick.mockClear();

		expect((await call(INTERRUPT, id, locals, "POST")).status).toBe(200);

		expect(await collections.abortedGenerations.findOne({ conversationId })).not.toBeNull();
		expect(await collections.queuedInputs.findOne({ conversationId })).toMatchObject({
			status: "queued",
		});
		expect(kick).not.toHaveBeenCalled();
		await collections.generations.deleteMany({ conversationId });
	});

	it("send now with no turn running starts the queue straight away", async () => {
		const { locals, id } = await mlConversation();
		await call(POST, id, locals, "POST", { text: "go" });
		kick.mockClear();

		expect((await call(INTERRUPT, id, locals, "POST")).status).toBe(200);
		expect(kick).toHaveBeenCalledTimes(1);
	});
});
