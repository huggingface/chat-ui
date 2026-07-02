import { describe, expect, it, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import superjson from "superjson";
import { collections } from "$lib/server/database";
import type { Message } from "$lib/types/Message";
import {
	MessageUpdateType,
	MessageUpdateStatus,
	MessageReasoningUpdateType,
	MessageToolUpdateType,
} from "$lib/types/MessageUpdate";
import {
	createTestLocals,
	createTestUser,
	createTestConversation,
	cleanupTestData,
} from "./testHelpers";

import { GET, DELETE, PATCH } from "../../../../routes/api/v2/conversations/[id]/+server";

async function parseResponse<T = unknown>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

function mockUrl(): URL {
	return new URL("http://localhost:5173/api/v2/conversations/some-id");
}

describe.sequential("GET /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("returns conversation data for owner", { timeout: 15000 }, async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			title: "My Conversation",
			model: "test-model",
			preprompt: "You are helpful.",
		});

		const res = await GET({
			locals,
			params: { id: conv._id.toString() },
			url: mockUrl(),
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{
			title: string;
			model: string;
			preprompt: string;
			id: string;
		}>(res);
		expect(data.title).toBe("My Conversation");
		expect(data.model).toBe("test-model");
		expect(data.preprompt).toBe("You are helpful.");
		expect(data.id).toBe(conv._id.toString());
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await GET({
				locals,
				params: { id: fakeId },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 403 for another user's conversation", async () => {
		const { locals: localsA } = await createTestUser();
		const { locals: localsB } = await createTestUser();
		const conv = await createTestConversation(localsA, { title: "Private Chat" });

		try {
			await GET({
				locals: localsB,
				params: { id: conv._id.toString() },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(403);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await GET({
				locals,
				params: { id: new ObjectId().toString() },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	it("throws 400 for invalid ObjectId format", async () => {
		const { locals } = await createTestUser();

		try {
			await GET({
				locals,
				params: { id: "not-a-valid-objectid" },
				url: mockUrl(),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it("trims unread payload from tool-less messages", { timeout: 15000 }, async () => {
		const { locals } = await createTestUser();
		const content = "Hello world response";
		const conv = await createTestConversation(locals, {
			messages: [
				{
					id: crypto.randomUUID(),
					from: "assistant",
					content,
					reasoning: "chain of thought",
					updates: [
						{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Started },
						{ type: MessageUpdateType.Stream, token: "", len: 12 },
						{ type: MessageUpdateType.Stream, token: "", len: 8 },
						{
							type: MessageUpdateType.Reasoning,
							subtype: MessageReasoningUpdateType.Stream,
							token: "chain of thought",
						},
						{
							type: MessageUpdateType.Reasoning,
							subtype: MessageReasoningUpdateType.Status,
							status: "Done in 2s",
						},
						{ type: MessageUpdateType.FinalAnswer, text: content, interrupted: false },
						{ type: MessageUpdateType.Title, title: "A title" },
					],
					ancestors: [],
					children: [],
				},
			],
		});

		const res = await GET({
			locals,
			params: { id: conv._id.toString() },
			url: mockUrl(),
		} as never);

		const data = await parseResponse<{ messages: Message[] }>(res);
		const message = data.messages.find((m) => m.from === "assistant");
		expect(message).toBeDefined();
		if (!message) return;
		const updates = message.updates ?? [];

		// content is authoritative and untouched
		expect(message.content).toBe(content);
		// server-side reasoning accumulator and raw reasoning tokens are not shipped
		expect(message.reasoning).toBeUndefined();
		expect(
			updates.some(
				(u) =>
					u.type === MessageUpdateType.Reasoning && u.subtype === MessageReasoningUpdateType.Stream
			)
		).toBe(false);
		// tool-less messages drop stream markers and the FinalAnswer text duplicate
		expect(updates.some((u) => u.type === MessageUpdateType.Stream)).toBe(false);
		const finalAnswer = updates.find((u) => u.type === MessageUpdateType.FinalAnswer);
		expect(finalAnswer).toMatchObject({ text: "", interrupted: false });
		// generation-state signals survive
		expect(updates.some((u) => u.type === MessageUpdateType.Status)).toBe(true);
		expect(updates.some((u) => u.type === MessageUpdateType.Title)).toBe(true);
	});

	it("keeps stream markers and FinalAnswer text for messages with tool calls", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			messages: [
				{
					id: crypto.randomUUID(),
					from: "assistant",
					content: "text before tool. text after tool.",
					updates: [
						{ type: MessageUpdateType.Stream, token: "", len: 17 },
						{
							type: MessageUpdateType.Tool,
							subtype: MessageToolUpdateType.Call,
							uuid: "tool-1",
							call: { name: "search", parameters: {} },
						},
						{
							type: MessageUpdateType.Reasoning,
							subtype: MessageReasoningUpdateType.Stream,
							token: "thinking",
						},
						{
							type: MessageUpdateType.FinalAnswer,
							text: "text after tool.",
							interrupted: false,
						},
					],
					ancestors: [],
					children: [],
				},
			],
		});

		const res = await GET({
			locals,
			params: { id: conv._id.toString() },
			url: mockUrl(),
		} as never);

		const data = await parseResponse<{ messages: Message[] }>(res);
		const updates = data.messages.find((m) => m.from === "assistant")?.updates ?? [];

		// tool messages need markers + final text to interleave text between tool blocks
		expect(updates.some((u) => u.type === MessageUpdateType.Stream)).toBe(true);
		const finalAnswer = updates.find((u) => u.type === MessageUpdateType.FinalAnswer);
		expect(finalAnswer).toMatchObject({ text: "text after tool." });
		expect(updates.some((u) => u.type === MessageUpdateType.Tool)).toBe(true);
		// raw reasoning tokens are dropped regardless of tools
		expect(
			updates.some(
				(u) =>
					u.type === MessageUpdateType.Reasoning && u.subtype === MessageReasoningUpdateType.Stream
			)
		).toBe(false);
	});
});

describe.sequential("DELETE /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("removes owned conversation", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "To Delete" });

		const res = await DELETE({
			locals,
			params: { id: conv._id.toString() },
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{ success: boolean }>(res);
		expect(data.success).toBe(true);

		const found = await collections.conversations.findOne({ _id: conv._id });
		expect(found).toBeNull();
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await DELETE({
				locals,
				params: { id: fakeId },
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await DELETE({
				locals,
				params: { id: new ObjectId().toString() },
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});
});

describe.sequential("PATCH /api/v2/conversations/[id]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("updates title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Old Title" });

		const res = await PATCH({
			locals,
			params: { id: conv._id.toString() },
			request: new Request("http://localhost", {
				method: "PATCH",
				body: JSON.stringify({ title: "New Title" }),
				headers: { "Content-Type": "application/json" },
			}),
		} as never);

		expect(res.status).toBe(200);
		const data = await parseResponse<{ success: boolean }>(res);
		expect(data.success).toBe(true);

		const updated = await collections.conversations.findOne({ _id: conv._id });
		expect(updated?.title).toBe("New Title");
	});

	it("strips <think> tags from title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Old Title" });

		const res = await PATCH({
			locals,
			params: { id: conv._id.toString() },
			request: new Request("http://localhost", {
				method: "PATCH",
				body: JSON.stringify({ title: "<think>hidden</think>Visible Title" }),
				headers: { "Content-Type": "application/json" },
			}),
		} as never);

		expect(res.status).toBe(200);

		const updated = await collections.conversations.findOne({ _id: conv._id });
		expect(updated?.title).toBe("hiddenVisible Title");
	});

	it("rejects empty title", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Original" });

		try {
			await PATCH({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it("rejects title longer than 100 characters", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "Original" });
		const longTitle = "a".repeat(101);

		try {
			await PATCH({
				locals,
				params: { id: conv._id.toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: longTitle }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it("throws 404 for non-existent conversation", async () => {
		const { locals } = await createTestUser();
		const fakeId = new ObjectId().toString();

		try {
			await PATCH({
				locals,
				params: { id: fakeId },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "New Title" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	it("throws 401 for unauthenticated request", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });

		try {
			await PATCH({
				locals,
				params: { id: new ObjectId().toString() },
				request: new Request("http://localhost", {
					method: "PATCH",
					body: JSON.stringify({ title: "New Title" }),
					headers: { "Content-Type": "application/json" },
				}),
			} as never);
			expect.fail("Should have thrown");
		} catch (e: unknown) {
			expect((e as { status: number }).status).toBe(401);
		}
	});
});
