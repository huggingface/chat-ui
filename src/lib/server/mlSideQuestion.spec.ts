import { ObjectId } from "mongodb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import type { EndpointParameters } from "$lib/server/endpoints/endpoints";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";

const mocks = vi.hoisted(() => ({
	endpoint: vi.fn(),
	contextLength: undefined as number | undefined,
}));

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/models", () => {
	const model = {
		id: "test-model",
		name: "test-model",
		parameters: {},
		get contextLength() {
			return mocks.contextLength;
		},
		getEndpoint: async () => mocks.endpoint,
	};
	return {
		models: [model],
		validateModel: () => z.string(),
		validModelIdSchema: z.string(),
	};
});
vi.mock("$lib/server/mlAssistantModels", () => ({
	mlAssistantModelEntry: () => ({ id: "test-model", provider: "fake", parameters: { top_p: 0.9 } }),
	mlAssistantProviderFor: () => "fake",
}));

const { answerSideQuestion, renderTranscript } = await import("./mlSideQuestion");

beforeAll(async () => {
	await ready;
});

function streamOf(tokens: string[]) {
	return async function* () {
		let text = "";
		for (const [i, token] of tokens.entries()) {
			text += token;
			const last = i === tokens.length - 1;
			yield {
				token: { id: i, text: token, logprob: 0, special: last },
				generated_text: last ? text : null,
				details: null,
			};
		}
	};
}

const callUuid = "11111111-1111-4111-8111-111111111111";

function liveTurn(): Message[] {
	return [
		{
			id: "u1" as Message["id"],
			from: "user",
			content: "Fine-tune bert on imdb",
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: "a1" as Message["id"],
			from: "assistant",
			content: "Submitting the training job.",
			createdAt: new Date(),
			updatedAt: new Date(),
			updates: [
				{
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Call,
					uuid: callUuid,
					call: { name: "hf_jobs", parameters: { operation: "run" } },
				},
				{
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid: callUuid,
					result: {
						status: ToolResultStatus.Success,
						call: { name: "hf_jobs", parameters: {} },
						outputs: [{ text: "Job 69abc submitted on a10g-small" }],
					},
				},
			],
		},
	] as Message[];
}

async function collect(gen: AsyncGenerator<string>) {
	let text = "";
	for await (const chunk of gen) text += chunk;
	return text;
}

describe("answerSideQuestion", () => {
	afterEach(async () => {
		vi.clearAllMocks();
		mocks.contextLength = undefined;
		await cleanupTestData();
		await collections.generations.deleteMany({});
	});

	it("answers from the live turn with no tools and writes nothing", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			messages: liveTurn(),
		});
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: "gen-1",
			conversationId: conv._id,
			messageId: "a1" as Message["id"],
			status: "running",
			seq: 4,
			lastHeartbeatAt: new Date(),
			startedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		mocks.endpoint.mockImplementation(async () =>
			streamOf(["<think>check the job", "</think>Job ", "69abc is ", "running."])()
		);
		const before = await collections.conversations.findOne({ _id: conv._id });
		const eventsBefore = await collections.generationEvents.countDocuments({});

		const answer = await collect(
			answerSideQuestion({
				conversationId: conv._id,
				question: "which job did it start?",
				locals,
			})
		);

		expect(answer).toBe("Job 69abc is running.");
		expect(mocks.endpoint).toHaveBeenCalledTimes(1);
		const params = mocks.endpoint.mock.calls[0][0] as EndpointParameters & Record<string, unknown>;
		expect(params).not.toHaveProperty("tools");
		expect(params.conversationId).toBeUndefined();
		expect(params.generateSettings).toMatchObject({ top_p: 0.9, max_tokens: 4096 });
		expect(params.reasoningEffort).toBeUndefined();
		expect(params.messages).toHaveLength(1);
		const prompt = String(params.messages[0].content);
		expect(params.messages[0].from).toBe("user");
		expect(params.messages[0].updates).toBeUndefined();
		expect(prompt).toContain("Fine-tune bert on imdb");
		expect(prompt).toContain("### Tool call: hf_jobs");
		expect(prompt).toContain("Job 69abc submitted on a10g-small");
		expect(prompt).toContain("The run is in progress");
		expect(prompt).toContain("Side question: which job did it start?");
		expect(params.preprompt).toContain("cannot call tools");

		const after = await collections.conversations.findOne({ _id: conv._id });
		expect(after).toEqual(before);
		expect(await collections.generationEvents.countDocuments({})).toBe(eventsBefore);
	});

	it("keeps reasoning for the current turn only and fits the model window", async () => {
		const { locals } = await createTestUser();
		const old = liveTurn().map((m) => ({ ...m, id: `old-${m.id}` as Message["id"] }));
		old[1] = { ...old[1], content: "Done.", reasoning: "OLD REASONING", updates: [] };
		const current = liveTurn();
		current[1] = { ...current[1], reasoning: "CURRENT REASONING" };
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			messages: [...old, ...current],
		});
		mocks.contextLength = 200_000;
		mocks.endpoint.mockImplementation(async () => streamOf(["ok"])());

		await collect(answerSideQuestion({ conversationId: conv._id, question: "why?", locals }));

		const prompt = String(mocks.endpoint.mock.calls[0][0].messages[0].content);
		expect(prompt).toContain("CURRENT REASONING");
		expect(prompt).not.toContain("OLD REASONING");
		expect(prompt).toContain("The run is not active");
	});

	it("asks for low effort only where the model or the user enables reasoning", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { mlAssistant: true, messages: liveTurn() });
		mocks.endpoint.mockImplementation(async () => streamOf(["ok"])());

		await collect(
			answerSideQuestion({
				conversationId: conv._id,
				question: "why?",
				locals,
				settings: { providerOverrides: {}, reasoningOverrides: { "test-model": true } },
			})
		);

		expect(mocks.endpoint.mock.calls[0][0]).toMatchObject({
			reasoningEffort: "low",
			reasoningOverride: true,
		});
	});

	it("refuses conversations outside ML Intern", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { messages: liveTurn() });
		await expect(
			collect(answerSideQuestion({ conversationId: conv._id, question: "hi", locals }))
		).rejects.toThrow("only available in ML Intern");
		expect(mocks.endpoint).not.toHaveBeenCalled();
	});
});

describe("renderTranscript", () => {
	it("flattens tool rounds and drops the system prompt", () => {
		const text = renderTranscript([
			{ role: "system", content: "SYSTEM" },
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image_url", image_url: { url: "data:x" } },
				],
			},
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{ id: "c1", type: "function", function: { name: "hf_fs", arguments: '{"path":"a"}' } },
				],
			},
			{ role: "tool", tool_call_id: "c1", content: "file body" },
		]);
		expect(text).not.toContain("SYSTEM");
		expect(text).toContain("look[image]");
		expect(text).toContain('### Tool call: hf_fs\n{"path":"a"}');
		expect(text).toContain("### Tool result\nfile body");
	});
});
