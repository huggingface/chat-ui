import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";

const mocks = vi.hoisted(() => ({
	answer: vi.fn(),
	limits: {} as { messagesPerMinute?: number },
}));

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/usageLimits", () => ({ usageLimits: mocks.limits }));
vi.mock("$lib/server/mlSideQuestion", () => ({
	SIDE_QUESTION_MAX_CHARS: 4000,
	answerSideQuestion: mocks.answer,
}));

const { POST } = await import("../../../routes/conversation/[id]/btw/+server");

beforeAll(async () => {
	await ready;
});

function ask(id: string, locals: App.Locals, body: unknown): Promise<Response> {
	return Promise.resolve(
		POST({
			params: { id },
			locals,
			request: new Request(`http://localhost/conversation/${id}/btw`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			getClientAddress: () => "127.0.0.1",
		} as never)
	).catch((thrown: { status: number }) => new Response(null, { status: thrown.status }));
}

describe.sequential("POST /conversation/[id]/btw", () => {
	afterEach(async () => {
		vi.clearAllMocks();
		delete mocks.limits.messagesPerMinute;
		await collections.messageEvents.deleteMany({});
		await cleanupTestData();
	});

	it("streams the answer and leaves the conversation untouched", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		mocks.answer.mockImplementation(async function* () {
			yield "The job ";
			yield "is training.";
		});

		const res = await ask(conv._id.toString(), locals, { question: "  what is running?  " });

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
		expect(await res.text()).toBe("The job is training.");
		const call = mocks.answer.mock.calls[0][0];
		expect(call.question).toBe("what is running?");
		expect(call.conversationId.toString()).toBe(conv._id.toString());
		expect(call.locals).toBe(locals);
		const stored = await collections.conversations.findOne({ _id: conv._id });
		expect(stored?.messages).toEqual([]);
		expect(stored?.updatedAt).toEqual(conv.updatedAt);
	});

	it("refuses another user's conversation", async () => {
		const owner = await createTestUser();
		const other = await createTestUser();
		const conv = await createTestConversation(owner.locals, { mlAssistant: true });

		const res = await ask(conv._id.toString(), other.locals, { question: "hi" });

		expect(res.status).toBe(404);
		expect(mocks.answer).not.toHaveBeenCalled();
	});

	it("refuses conversations outside ML Intern and empty questions", async () => {
		const { locals } = await createTestUser();
		const plain = await createTestConversation(locals);
		const ml = await createTestConversation(locals, { mlAssistant: true });

		expect((await ask(plain._id.toString(), locals, { question: "hi" })).status).toBe(400);
		expect((await ask(ml._id.toString(), locals, { question: "   " })).status).toBe(400);
		expect((await ask(new ObjectId().toString(), locals, { question: "hi" })).status).toBe(404);
		expect(mocks.answer).not.toHaveBeenCalled();
	});

	it("rate limits side questions per address as well as per account", async () => {
		mocks.limits.messagesPerMinute = 1;
		mocks.answer.mockImplementation(async function* () {
			yield "ok";
		});
		const first = await createTestUser();
		const second = await createTestUser();
		const a = await createTestConversation(first.locals, { mlAssistant: true });
		const b = await createTestConversation(second.locals, { mlAssistant: true });

		expect((await ask(a._id.toString(), first.locals, { question: "one" })).status).toBe(200);
		expect((await ask(b._id.toString(), second.locals, { question: "two" })).status).toBe(429);
		expect(mocks.answer).toHaveBeenCalledTimes(1);
	});

	it("answers an upstream failure before the first chunk with an error status", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true });
		// eslint-disable-next-line require-yield
		mocks.answer.mockImplementation(async function* () {
			throw new Error("upstream 500");
		});

		const res = await ask(conv._id.toString(), locals, { question: "status?" });

		expect(res.status).toBe(502);
	});
});
