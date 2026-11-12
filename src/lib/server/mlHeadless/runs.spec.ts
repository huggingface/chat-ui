import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { cleanupTestData, createTestUser } from "$lib/server/api/__tests__/testHelpers";
import { streamFor, type Round } from "$lib/server/textGeneration/__tests__/replayHarness";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";
import {
	headlessLocals,
	isAllowedCaller,
	provisionHeadlessIdentity,
	resetHeadlessAccountCache,
} from "./identity";
import { HeadlessRunError, findRun, readRun, startRun, stopRun, type RunStatus } from "./runs";
import { headlessSessionId } from "./session";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	enabled: true,
	account: { id: "hf-bot-id", name: "ml-intern-bot" },
	settings: {
		hfToken: "hf-headless-token",
		maxBudgetUsd: 25,
		publishNamespace: "ML-Intern-lab",
		billingOrganization: "ML-Intern-lab",
		allowedUsers: ["trusted-human"],
	},
}));
vi.mock("$lib/server/config", async (original) => {
	const m = await original<typeof import("$lib/server/config")>();
	return {
		...m,
		config: new Proxy(m.config, {
			get(target, key) {
				// Keep replayed model rounds focused on the assistant, not title inference.
				if (key === "LLM_SUMMARIZATION") return "false";
				if (key === "PUBLIC_ORIGIN") return "https://huggingface.co";
				if (key === "USE_USER_TOKEN" || key === "MCP_FORWARD_HF_USER_TOKEN") return "true";
				return Reflect.get(target, key);
			},
		}),
	};
});
vi.mock("./config", () => ({ headlessConfig: () => mocks.enabled && mocks.settings }));
vi.mock("openai", async (original) => ({
	...(await original<typeof import("openai")>()),
	OpenAI: class {
		chat = { completions: { create: mocks.create } };
	},
}));
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mlAssistantModels", async (original) => ({
	...(await original<typeof import("$lib/server/mlAssistantModels")>()),
	resolveMlAssistantModel: () => "test-org/test-model",
}));
vi.mock("$lib/server/mcp/registry", () => ({
	getMcpServers: () => [],
	loadMcpServersOnStartup: () => [],
}));
vi.mock("$lib/server/mcp/tools", () => ({
	getOpenAiToolsForMcp: async () => ({ tools: [], mapping: {} }),
	resetMcpToolsCache: () => {},
}));
vi.mock("$lib/server/urlSafety", async (original) => ({
	...(await original<typeof import("$lib/server/urlSafety")>()),
	isValidUrl: () => true,
}));
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: async () => ({}) }));
vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: vi.fn(),
	getMcpToolTimeoutMs: () => 2000,
}));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const realFetch = globalThis.fetch;

beforeEach(async () => {
	await ready;
	mocks.create.mockReset();
	mocks.enabled = true;
	mocks.account = { id: "hf-bot-id", name: "ml-intern-bot" };
	resetHeadlessAccountCache();
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		if (String(input).includes("/api/whoami-v2")) return Response.json(mocks.account);
		return realFetch(input, init);
	});
});
afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupTestData();
});

function rounds(...items: Round[]) {
	let i = 0;
	mocks.create.mockImplementation(async () => {
		const next = items[i++];
		if (!next) throw new Error("Unexpected extra model request");
		return streamFor(next);
	});
}

async function settle(identity: Awaited<ReturnType<typeof provisionHeadlessIdentity>>, id: string) {
	let status: RunStatus = "running";
	await expect
		.poll(
			async () => {
				const conv = await findRun(identity, id);
				status = conv ? (await readRun(conv)).status : "running";
				return status;
			},
			{ timeout: 10_000 }
		)
		.not.toBe("running");
	const conv = await findRun(identity, id);
	if (!conv) throw new Error("run vanished");
	return readRun(conv);
}

describe("headless ML Intern runs", () => {
	it("runs a prompt to completion as the token's account and reports the answer", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		expect(identity.hfUserId).toBe("hf-bot-id");
		rounds({ content: "Built it.\nARTIFACTS: ML-Intern-lab/demo" });

		const id = await startRun(identity, mocks.settings, { prompt: "Build a demo", budgetUsd: 5 });
		const view = await settle(identity, id.toHexString());

		expect(view.status).toBe("done");
		expect(view.finalAnswer).toContain("ARTIFACTS: ML-Intern-lab/demo");
		expect(view.budgetUsd).toBe(5);
		expect(view.url).toBe(`https://huggingface.co/conversation/${id.toHexString()}`);
		const conv = await collections.conversations.findOne({ _id: id });
		expect(conv?.mlAssistant).toBe(true);
		expect(conv?.sessionId).toBe(headlessSessionId(identity._id));
		// The server's destination and payer reach the run, not the account's own settings.
		const prompt = JSON.stringify(mocks.create.mock.calls[0][0].messages);
		expect(prompt).toContain("PublishTo=ML-Intern-lab");
		expect(prompt).toContain("BillTo=ML-Intern-lab");
	});

	it("reports a parked wait, resumes with the configured token, and stops cleanly", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		rounds({
			toolCalls: [
				{
					id: "wait",
					name: "wait",
					arguments: JSON.stringify({ seconds: 600, reason: "Training is running" }),
				},
			],
		});
		const id = await startRun(identity, mocks.settings, { prompt: "Train", budgetUsd: 1 });
		const waiting = await settle(identity, id.toHexString());
		expect(waiting.status).toBe("waiting");
		expect(waiting.waitReason).toBe("Training is running");

		const park = await collections.parkedCalls.findOne({ conversationId: id });
		expect(park?.sessionId).toBe(headlessSessionId(identity._id));
		const resume = await rebuildIdentity({ userId: identity._id, sessionId: park?.sessionId });
		expect(resume.locals.token).toBe("hf-headless-token");
		expect(resume.locals.publishNamespace).toBe("ML-Intern-lab");
		expect(resume.locals.billingOrganization).toBe("ML-Intern-lab");
		expect(resume.tokenExpired).toBe(false);
		// The same account's own chats never borrow the server's token.
		const own = await rebuildIdentity({ userId: identity._id });
		expect(own.locals.token).toBeUndefined();

		const conv = await findRun(identity, id.toHexString());
		if (!conv) throw new Error("no run");
		await stopRun(identity, conv);
		const stopped = await findRun(identity, id.toHexString());
		if (!stopped) throw new Error("no run");
		const view = await readRun(stopped);
		expect(view.status).toBe("stopped");
		expect(view.error).toBe("Stopped through the API");
		expect(
			await collections.parkedCalls.countDocuments({ conversationId: id, status: "waiting" })
		).toBe(0);
		expect(await collections.abortedGenerations.countDocuments({ conversationId: id })).toBe(0);
	});

	it("surfaces a question as asking", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		rounds({
			toolCalls: [
				{
					id: "ask",
					name: "ask_user_question",
					arguments: JSON.stringify({
						questions: [
							{
								question: "Which base model?",
								header: "Model",
								multiSelect: false,
								options: [
									{ label: "Small", description: "Fast" },
									{ label: "Large", description: "Better" },
								],
							},
						],
					}),
				},
			],
		});
		const id = await startRun(identity, mocks.settings, { prompt: "Fine-tune", budgetUsd: 1 });
		const view = await settle(identity, id.toHexString());
		expect(view.status).toBe("asking");
		expect(view.question).toBeTruthy();

		const conv = await findRun(identity, id.toHexString());
		if (!conv) throw new Error("no run");
		await stopRun(identity, conv);
		const stopped = await findRun(identity, id.toHexString());
		if (!stopped) throw new Error("no run");
		expect((await readRun(stopped)).status).toBe("stopped");
		expect(
			await collections.mcpElicitations.countDocuments({ conversationId: id, status: "pending" })
		).toBe(0);
	});

	it("refuses a budget above the server cap without creating a conversation", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		await expect(
			startRun(identity, mocks.settings, { prompt: "Pretrain", budgetUsd: 26 })
		).rejects.toBeInstanceOf(HeadlessRunError);
		expect(await collections.conversations.countDocuments({ userId: identity._id })).toBe(0);
	});

	it("allows the token's account and listed users only", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		const { user: other } = await createTestUser();
		expect(await isAllowedCaller(identity, mocks.settings)).toBe(true);
		expect(await isAllowedCaller(other, mocks.settings)).toBe(false);
		expect(await isAllowedCaller({ ...other, username: "trusted-human" }, mocks.settings)).toBe(
			true
		);
		expect(await isAllowedCaller(undefined, mocks.settings)).toBe(false);
	});

	it("scopes runs to the headless identity and falls back when the token is gone", async () => {
		const identity = await provisionHeadlessIdentity(mocks.settings);
		rounds({ content: "done" });
		const id = await startRun(identity, mocks.settings, { prompt: "x", budgetUsd: 0 });
		await settle(identity, id.toHexString());
		const { user: other } = await createTestUser();
		expect(await findRun(other, id.toHexString())).toBeNull();
		expect(await findRun(identity, "not-an-id")).toBeNull();
		// A chat the account started in the UI is not a run.
		const own = await collections.conversations.insertOne({
			...(await collections.conversations.findOne({ _id: id })),
			_id: new ObjectId(),
			sessionId: undefined,
		} as Conversation);
		expect(await findRun(identity, own.insertedId.toHexString())).toBeNull();

		mocks.account = { id: "someone-else", name: "else" };
		resetHeadlessAccountCache();
		await expect(headlessLocals(identity)).rejects.toThrow(/different account/);
		// A resume then falls back to the account's own session instead of throwing.
		const sessionId = headlessSessionId(identity._id);
		const moved = await rebuildIdentity({ userId: identity._id, sessionId });
		expect(moved.locals.token).toBeUndefined();
		expect(moved.tokenExpired).toBe(true);

		mocks.account = { id: "hf-bot-id", name: "ml-intern-bot" };
		resetHeadlessAccountCache();
		mocks.enabled = false;
		const off = await rebuildIdentity({ userId: identity._id, sessionId });
		expect(off.locals.token).toBeUndefined();
		expect(off.tokenExpired).toBe(true);
	});
});
