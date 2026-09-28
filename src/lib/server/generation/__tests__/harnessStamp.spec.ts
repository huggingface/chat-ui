import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import { streamFor, type Round } from "$lib/server/textGeneration/__tests__/replayHarness";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	env: {} as Record<string, string>,
}));

vi.mock("openai", async (importOriginal) => ({
	...(await importOriginal<typeof import("openai")>()),
	OpenAI: class {
		chat = { completions: { create: mocks.create } };
	},
}));
vi.mock("$lib/server/config", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/config")>();
	return {
		...actual,
		config: new Proxy(actual.config, {
			get: (target, prop) =>
				typeof prop === "string" && prop in mocks.env ? mocks.env[prop] : Reflect.get(target, prop),
		}),
	};
});
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mcp/registry", () => ({
	getMcpServers: () => [{ name: "Configured", url: "https://configured.test/mcp" }],
	loadMcpServersOnStartup: () => [],
}));
vi.mock("$lib/server/urlSafety", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/urlSafety")>()),
	isValidUrl: () => true,
}));
vi.mock("$lib/server/mcp/tools", () => ({
	getOpenAiToolsForMcp: async () => ({ tools: [], mapping: {} }),
	resetMcpToolsCache: () => {},
}));
vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: vi.fn(),
	getMcpToolTimeoutMs: () => 2_000,
}));
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: async () => ({}) }));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const { POST } = await import("../../../../routes/conversation/[id]/+server");
const { POST: ANSWER } = await import("../../../../routes/conversation/[id]/elicitation/+server");
const { resumeParkedCall } = await import("../parkedSweeper");

const MODEL_ID = "test-org/test-model";

const ASK: Round = {
	toolCalls: [
		{
			id: "call_ask",
			name: "ask_user_question",
			arguments: JSON.stringify({
				questions: [
					{
						question: "Which database should the pipeline write to?",
						header: "Database",
						multiSelect: false,
						options: [
							{ label: "Postgres", description: "Relational." },
							{ label: "Mongo", description: "Document." },
						],
					},
				],
			}),
		},
	],
};

const WAIT: Round = {
	toolCalls: [
		{
			id: "call_wait",
			name: "wait",
			arguments: JSON.stringify({ seconds: 600, reason: "training job to finish" }),
		},
	],
};

function scriptRounds(rounds: Round[]) {
	let next = 0;
	mocks.create.mockImplementation(async () => {
		const round = rounds[next++];
		if (!round) throw new Error(`upstream called ${next}x but only ${rounds.length} scripted`);
		return streamFor(round);
	});
}

async function newConversation(overrides: Partial<Conversation> = {}) {
	const { locals } = await createTestUser();
	const rootId = crypto.randomUUID();
	const conv = await createTestConversation(locals, {
		model: MODEL_ID,
		title: "t",
		mlAssistant: true,
		rootMessageId: rootId,
		messages: [
			{
				id: rootId,
				from: "system",
				content: "",
				ancestors: [],
				children: [],
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		],
		...overrides,
	});
	return { conv, locals };
}

async function lastAssistant(conv: Conversation): Promise<Message> {
	const fresh = await collections.conversations.findOne({ _id: conv._id });
	const message = fresh?.messages.findLast((m) => m.from === "assistant");
	if (!message) throw new Error("no assistant message");
	return message;
}

async function sendMessage(conv: Conversation, locals: App.Locals, prompt: string) {
	const fresh = await collections.conversations.findOne({ _id: conv._id });
	const form = new FormData();
	form.set("data", JSON.stringify({ inputs: prompt, id: fresh?.messages.at(-1)?.id }));
	const response = await POST({
		request: new Request(`http://localhost/conversation/${conv._id}`, {
			method: "POST",
			body: form,
		}),
		locals,
		params: { id: conv._id.toString() },
		getClientAddress: () => "127.0.0.1",
	} as never);
	if (response.status !== 200) {
		throw new Error(`POST returned ${response.status}: ${await response.text()}`);
	}
	// the route saves the turn only once the body is drained
	const reader = response.body?.getReader();
	if (!reader) throw new Error("no response body");
	while (!(await reader.read()).done);
}

const turnDone = (conv: Conversation, messageId: string) =>
	vi.waitFor(
		async () => {
			const state = await collections.turnStates.findOne({ conversationId: conv._id, messageId });
			expect(state?.status).toBe("done");
			expect(
				await collections.generations.countDocuments({
					conversationId: conv._id,
					status: "running",
				})
			).toBe(0);
		},
		{ timeout: 10_000, interval: 25 }
	);

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	mocks.create.mockReset();
});

afterEach(async () => {
	for (const key of Object.keys(mocks.env)) delete mocks.env[key];
	await cleanupTestData();
	await Promise.all([
		collections.mcpElicitations.deleteMany({}),
		collections.parkedCalls.deleteMany({}),
		collections.turnStates.deleteMany({}),
		collections.generations.deleteMany({}),
		collections.generationEvents.deleteMany({}),
	]);
});

describe("the harness stamp", () => {
	it("is set on a fresh turn in the mode", async () => {
		mocks.env.PUBLIC_COMMIT_SHA = "abc1234";
		const { conv, locals } = await newConversation();
		scriptRounds([{ content: "Hello." }]);

		await sendMessage(conv, locals, "hi");

		const message = await lastAssistant(conv);
		expect(message.content).toBe("Hello.");
		expect(message.harness).toEqual({
			build: "abc1234",
			prompt: expect.stringMatching(/^[0-9a-f]{12}$/),
			features: {
				virtualFiles: true,
				stateBlock: true,
				servicePoller: true,
				serviceEvents: true,
				slidingWindow: true,
			},
			model: MODEL_ID,
			runs: 1,
		});
	});

	it("is absent outside the mode", async () => {
		const { conv, locals } = await newConversation({ mlAssistant: false });
		scriptRounds([{ content: "Hello." }]);

		await sendMessage(conv, locals, "hi");

		const message = await lastAssistant(conv);
		expect(message.content).toBe("Hello.");
		expect(message).not.toHaveProperty("harness");
	});

	it("is overwritten when an answered question resumes the turn", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		await sendMessage(conv, locals, "Build me a pipeline.");
		const parked = await lastAssistant(conv);
		expect(parked.harness).toMatchObject({ features: { stateBlock: true }, runs: 1 });
		const row = await collections.mcpElicitations.findOne({ conversationId: conv._id });
		if (!row) throw new Error("the turn did not park on a question");

		mocks.env.ML_ASSISTANT_STATE_BLOCK = "false";
		await ANSWER({
			request: new Request(`http://localhost/conversation/${conv._id}/elicitation`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					elicitationId: row.elicitationId,
					action: "accept",
					content: { q1: "Postgres" },
				}),
			}),
			locals,
			params: { id: conv._id.toString() },
		} as never);
		await turnDone(conv, parked.id);

		const resumed = await lastAssistant(conv);
		expect(resumed.id).toBe(parked.id);
		expect(resumed.content).toContain("Postgres it is.");
		expect(resumed.harness).toMatchObject({ features: { stateBlock: false }, runs: 2 });
		expect(resumed.harness?.prompt).not.toBe(parked.harness?.prompt);
	});

	it("is overwritten when a parked wait resumes the turn after a deploy", async () => {
		mocks.env.PUBLIC_COMMIT_SHA = "old-build";
		const { conv, locals } = await newConversation();
		scriptRounds([WAIT, { content: "The job finished." }]);
		await sendMessage(conv, locals, "Train it.");
		const parked = await lastAssistant(conv);
		expect(parked.harness).toMatchObject({ build: "old-build", runs: 1 });
		const row = await collections.parkedCalls.findOne({ conversationId: conv._id });
		if (!row) throw new Error("the turn did not park on a wait");

		mocks.env.PUBLIC_COMMIT_SHA = "new-build";
		await resumeParkedCall(row);

		const resumed = await lastAssistant(conv);
		expect(resumed.id).toBe(parked.id);
		expect(resumed.content).toContain("The job finished.");
		expect(resumed.harness).toMatchObject({
			build: "new-build",
			prompt: parked.harness?.prompt,
			runs: 2,
		});
	});
});
