import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { v4 } from "uuid";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { collections } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";

const { generationScenarios, observedGenerationMessages, abortScenarioStep, mockGetEndpoint } =
	vi.hoisted(() => ({
		generationScenarios: [] as Array<Array<MessageUpdate | symbol>>,
		observedGenerationMessages: [] as Message[][],
		abortScenarioStep: Symbol("abort"),
		mockGetEndpoint: vi.fn(async () => ({ type: "mock-endpoint" })),
	}));

vi.mock("$lib/server/models", async () => {
	const { z } = await import("zod");

	return {
		models: [
			{
				id: "test-model",
				name: "Test Model",
				isRouter: true,
				getEndpoint: mockGetEndpoint,
			},
		],
		validModelIdSchema: z.string(),
	};
});

vi.mock("$lib/server/textGeneration", () => ({
	async *textGeneration ({ messages }: { messages: Message[] }) {
		observedGenerationMessages.push(messages.map((message) => ({ ...message })));
		const scenario = generationScenarios.shift() ?? [];
		for (const step of scenario) {
			if (step === abortScenarioStep) {
				const abortError = new Error("Request was aborted.");
				abortError.name = "AbortError";
				throw abortError;
			}
			yield step as MessageUpdate;
		}
	},
}));

vi.mock("$lib/server/metrics", () => ({
	MetricsServer: {
		isEnabled: () => false,
		getMetrics: () => undefined,
	},
}));

import { POST } from "../../../routes/conversation/[id]/+server";

function buildRequest(payload: Record<string, unknown>): Request {
	const form = new FormData();
	form.append("data", JSON.stringify(payload));

	return new Request("http://localhost/conversation", {
		method: "POST",
		body: form,
	});
}

async function parseJsonlResponse(response: Response): Promise<MessageUpdate[]> {
	const reader = response.body?.getReader();
	if (!reader) return [];

	const decoder = new TextDecoder();
	let text = "";
	let done = false;
	while (!done) {
		const { done: streamDone, value } = await reader.read();
		if (streamDone) {
			done = true;
			continue;
		}
		if (typeof value === "string") {
			text += value;
		} else if (value instanceof Uint8Array) {
			text += decoder.decode(value, { stream: true });
		}
	}

	text += decoder.decode();

	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as MessageUpdate);
}

async function invokePost(params: {
	conversationId: string;
	locals: App.Locals;
	payload: Record<string, unknown>;
}) {
	return POST({
		request: buildRequest(params.payload),
		locals: params.locals,
		params: { id: params.conversationId },
		getClientAddress: () => "127.0.0.1",
	} as never);
}

describe.sequential("POST /conversation/[id]", () => {
	afterEach(async () => {
		generationScenarios.length = 0;
		observedGenerationMessages.length = 0;
		vi.clearAllMocks();
		await cleanupTestData();
		await collections.messageEvents.deleteMany({});
	});

	it("throws 401 for unauthenticated requests", async () => {
		const locals = createTestLocals({ user: undefined, sessionId: undefined });

		try {
			await invokePost({
				conversationId: new ObjectId().toString(),
				locals,
				payload: { inputs: "hello" },
			});
			expect.fail("Expected 401 error");
		} catch (error) {
			expect((error as { status: number }).status).toBe(401);
		}
	});

	it("throws 404 when the conversation does not exist", async () => {
		const { locals } = await createTestUser();

		try {
			await invokePost({
				conversationId: new ObjectId().toString(),
				locals,
				payload: { inputs: "hello" },
			});
			expect.fail("Expected 404 error");
		} catch (error) {
			expect((error as { status: number }).status).toBe(404);
		}
	});

	it("creates user and assistant turns on normal send and streams updates", async () => {
		const { locals } = await createTestUser();
		const conversation = await createTestConversation(locals, { messages: [] });

		generationScenarios.push([
			{ type: MessageUpdateType.Stream, token: "Hello " },
			{ type: MessageUpdateType.Stream, token: "world" },
			{ type: MessageUpdateType.FinalAnswer, text: "Hello world", interrupted: false },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		]);

		const response = await invokePost({
			conversationId: conversation._id.toString(),
			locals,
			payload: { inputs: "Say hello" },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/jsonl");
		const updates = await parseJsonlResponse(response);
		expect(updates.some((update) => update.type === MessageUpdateType.Stream)).toBe(true);
		expect(
			updates.some(
				(update) =>
					update.type === MessageUpdateType.FinalAnswer &&
					update.text === "Hello world" &&
					update.interrupted === false
			)
		).toBe(true);

		const updatedConversation = await collections.conversations.findOne({ _id: conversation._id });
		expect(updatedConversation?.messages).toHaveLength(2);
		expect(updatedConversation?.messages[0]).toMatchObject({ from: "user", content: "Say hello" });
		expect(updatedConversation?.messages[1]).toMatchObject({
			from: "assistant",
			content: "Hello world",
		});
		expect(observedGenerationMessages[0].map((message) => message.from)).toEqual(["user"]);
		expect(observedGenerationMessages[0][0].content).toBe("Say hello");
		expect(mockGetEndpoint).toHaveBeenCalled();
	});

	it("uses retry-assistant subtree without including the retried assistant in prompt", async () => {
		const { locals } = await createTestUser();
		const rootId = v4();
		const userId = v4();
		const assistantId = v4();

		const conversation = await createTestConversation(locals, {
			rootMessageId: rootId,
			messages: [
				{
					id: rootId,
					from: "system",
					content: "sys",
					ancestors: [],
					children: [userId],
				},
				{
					id: userId,
					from: "user",
					content: "question",
					ancestors: [rootId],
					children: [assistantId],
				},
				{
					id: assistantId,
					from: "assistant",
					content: "old answer",
					ancestors: [rootId, userId],
					children: [],
				},
			],
		});

		generationScenarios.push([
			{ type: MessageUpdateType.FinalAnswer, text: "new answer", interrupted: false },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		]);

		const response = await invokePost({
			conversationId: conversation._id.toString(),
			locals,
			payload: { id: assistantId, is_retry: true },
		});
		await parseJsonlResponse(response);

		expect(observedGenerationMessages[0].map((message) => message.id)).toEqual([rootId, userId]);

		const updatedConversation = await collections.conversations.findOne({ _id: conversation._id });
		const assistants = (updatedConversation?.messages ?? []).filter(
			(message) => message.from === "assistant"
		);
		expect(assistants).toHaveLength(2);
		const newAssistant = assistants.find((message) => message.id !== assistantId);
		expect(newAssistant?.content).toBe("new answer");
		expect(newAssistant?.ancestors).toEqual([rootId, userId]);
	});

	it("merges final answers with streamed pre-tool content", async () => {
		const { locals } = await createTestUser();
		const conversation = await createTestConversation(locals, { messages: [] });

		generationScenarios.push([
			{ type: MessageUpdateType.Stream, token: "Draft story." },
			{
				type: MessageUpdateType.Tool,
				subtype: MessageToolUpdateType.Call,
				uuid: "tool-1",
				call: { name: "image", parameters: { prompt: "cat" } },
			},
			{ type: MessageUpdateType.FinalAnswer, text: "Image caption.", interrupted: false },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		]);

		const response = await invokePost({
			conversationId: conversation._id.toString(),
			locals,
			payload: { inputs: "Tell a story" },
		});
		await parseJsonlResponse(response);

		const updatedConversation = await collections.conversations.findOne({ _id: conversation._id });
		const assistant = updatedConversation?.messages.find((message) => message.from === "assistant");
		expect(assistant?.content).toBe("Draft story.\n\nImage caption.");
	});

	it("preserves route/model on provider-only router metadata updates", async () => {
		const { locals } = await createTestUser();
		const conversation = await createTestConversation(locals, { messages: [] });

		generationScenarios.push([
			{
				type: MessageUpdateType.RouterMetadata,
				route: "router-a",
				model: "model-a",
			},
			{
				type: MessageUpdateType.RouterMetadata,
				route: "",
				model: "",
				provider: "hf-inference" as never,
			},
			{ type: MessageUpdateType.FinalAnswer, text: "done", interrupted: false },
			{ type: MessageUpdateType.Status, status: MessageUpdateStatus.Finished },
		]);

		const response = await invokePost({
			conversationId: conversation._id.toString(),
			locals,
			payload: { inputs: "metadata" },
		});
		await parseJsonlResponse(response);

		const updatedConversation = await collections.conversations.findOne({ _id: conversation._id });
		const assistant = updatedConversation?.messages.find((message) => message.from === "assistant");
		expect(assistant?.routerMetadata).toEqual({
			route: "router-a",
			model: "model-a",
			provider: "hf-inference",
		});
	});

	it("emits interrupted final answer on abort", async () => {
		const { locals } = await createTestUser();
		const conversation = await createTestConversation(locals, { messages: [] });

		generationScenarios.push([
			{ type: MessageUpdateType.Stream, token: "partial answer" },
			abortScenarioStep,
		]);

		const response = await invokePost({
			conversationId: conversation._id.toString(),
			locals,
			payload: { inputs: "abort" },
		});
		const updates = await parseJsonlResponse(response);

		const interruptedFinal = updates.find(
			(update) => update.type === MessageUpdateType.FinalAnswer && update.interrupted === true
		);
		expect(interruptedFinal).toBeDefined();
		expect(interruptedFinal?.type).toBe(MessageUpdateType.FinalAnswer);
		expect((interruptedFinal as { text: string }).text).toBe("partial answer");

		const updatedConversation = await collections.conversations.findOne({ _id: conversation._id });
		const assistant = updatedConversation?.messages.find((message) => message.from === "assistant");
		expect(assistant?.content).toBe("partial answer");
		expect(assistant?.interrupted).toBe(true);
	});
});
