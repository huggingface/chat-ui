import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import { createTestUser, cleanupTestData } from "$lib/server/api/__tests__/testHelpers";
import { streamFor, type Round } from "$lib/server/textGeneration/__tests__/replayHarness";
import { getOrCreateThread, enqueueInput, inputKey, SlackLeader } from "./store";
import { ensureConversation, runSlackTurn, stopSlackTurn, skipSlackQuestion } from "./engine";
import { questionModal, readAnswers } from "./presentation";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import { kickAnsweredAsk } from "$lib/server/generation/askResume";
import { rebuildIdentity } from "$lib/server/generation/parkedSweeper";

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	settings: {
		teamId: "T123",
		accountMode: "user" as const,
		botToken: "xoxb-test",
		appToken: "xapp-test",
		hfToken: "hf-test-token",
		budgetUsd: 0,
		allowedChannels: [],
		billingOrganization: "test-org",
		publishNamespace: "ML-Intern-lab",
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
vi.mock("./config", () => ({ slackConfig: () => mocks.settings }));
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

beforeEach(async () => {
	await ready;
	mocks.create.mockReset();
});
afterEach(async () => {
	await cleanupTestData();
});

async function setup() {
	const { user } = await createTestUser();
	user.slackBotTeamId = mocks.settings.teamId;
	await collections.users.updateOne(
		{ _id: user._id },
		{ $set: { slackBotTeamId: user.slackBotTeamId } }
	);
	const thread = await getOrCreateThread("T123", "C123", "100.0", "U123");
	await ensureConversation(thread, user, mocks.settings);
	return { thread, user };
}

function rounds(...items: Round[]) {
	let i = 0;
	mocks.create.mockImplementation(async () => {
		const next = items[i++];
		if (!next) throw new Error("Unexpected extra model request");
		return streamFor(next);
	});
}

describe("Slack ML Intern persistence", () => {
	it("cancels a durable wait so a restarted sweeper cannot wake it", async () => {
		const { thread, user } = await setup();
		rounds({
			toolCalls: [
				{
					id: "wait",
					name: "wait",
					arguments: JSON.stringify({ seconds: 60, reason: "Training is still running" }),
				},
			],
		});
		await runSlackTurn(thread, user, { text: "Wait for the training job" });
		expect(
			await collections.parkedCalls.countDocuments({
				conversationId: thread.conversationId,
				status: "waiting",
			})
		).toBe(1);
		await stopSlackTurn(thread, user);
		expect(
			await collections.parkedCalls.countDocuments({
				conversationId: thread.conversationId,
				status: "waiting",
			})
		).toBe(0);
		expect(
			(await collections.turnStates.findOne({ conversationId: thread.conversationId }))?.status
		).toBe("failed");
		expect(
			await collections.abortedGenerations.countDocuments({ conversationId: thread.conversationId })
		).toBe(0);
		rounds({ content: "A fresh task can run immediately." });
		await runSlackTurn(thread, user, { text: "Start fresh" });
		expect(
			(await collections.conversations.findOne({ _id: thread.conversationId }))?.messages.at(-1)
				?.content
		).toContain("fresh task");
	});

	it("passes image attachments through the real upload pathway into the conversation", async () => {
		const { thread, user } = await setup();
		rounds({ content: "Image received." });
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
			"base64"
		);
		await runSlackTurn(thread, user, {
			text: "Read this image",
			files: [new File([png], "image.png", { type: "image/png" })],
		});
		const conv = await collections.conversations.findOne({ _id: thread.conversationId });
		const file = conv?.messages.find((m) => m.from === "user")?.files?.[0];
		expect(file).toMatchObject({ type: "hash", name: "image.png", mime: "image/png" });
		const stored: Buffer[] = [];
		for await (const chunk of collections.bucket.openDownloadStreamByName(
			`${thread.conversationId}-${file?.value}`
		))
			stored.push(chunk);
		expect(Buffer.concat(stored)).toEqual(png);
	});

	it("deduplicates Slack retries, keeps threads separate, and elects only one worker", async () => {
		const thread = await getOrCreateThread("T123", "C123", "100.0", "U123");
		const input = {
			_id: inputKey("T123", "event1"),
			threadId: thread._id,
			user: "U123",
			text: "build",
			ts: "100.0",
		};
		await Promise.all([enqueueInput(input), enqueueInput(input)]);
		expect(await collections.slackInputs.countDocuments({})).toBe(1);
		expect((await getOrCreateThread("T123", "C123", "100.0", "OTHER")).owner).toBe("U123");
		expect((await getOrCreateThread("T999", "C123", "100.0", "U123")).conversationId).not.toEqual(
			thread.conversationId
		);
		const first = new SlackLeader("T123");
		const second = new SlackLeader("T123");
		expect(await first.acquire()).toBe(true);
		expect(await second.acquire()).toBe(false);
		await first.release();
		expect(await second.acquire()).toBe(true);
	});

	it("skips a pending budget question without granting spend and accepts a fresh turn", async () => {
		const { thread, user } = await setup();
		rounds(
			{
				toolCalls: [
					{
						id: "ask",
						name: "ask_user_question",
						arguments: JSON.stringify({
							questions: [
								{
									question: "Grant budget?",
									header: "Budget",
									multiSelect: false,
									options: [
										{ label: "Grant", description: "Grant $5", setBudgetUsd: 5 },
										{ label: "Skip", description: "No grant" },
									],
								},
							],
						}),
					},
				],
			},
			{ content: "Handling the new request." }
		);
		await runSlackTurn(thread, user, { text: "Ask first" });
		const q = await collections.mcpElicitations.findOne({
			conversationId: thread.conversationId,
			status: "pending",
		});
		if (!q?.pending) throw Error("No question");
		await collections.mcpElicitations.updateOne(
			{ _id: q._id },
			{ $set: { slackSubmitting: true } }
		);
		expect(await skipSlackQuestion(thread, user, q.pending.messageId, "new-input")).toBe(false);
		await collections.mcpElicitations.updateOne(
			{ _id: q._id },
			{ $unset: { slackSubmitting: "" } }
		);
		expect(await skipSlackQuestion(thread, user, q.pending.messageId, "new-input")).toBe(true);
		expect(await collections.mcpElicitations.findOne({ _id: q._id })).toMatchObject({
			status: "resolved",
			action: "cancel",
			resolution: "user",
			resume: { status: "abandoned" },
		});
		const late = await submitElicitationAnswer({
			conversationId: thread.conversationId,
			elicitationId: q.elicitationId,
			action: "accept",
			content: { q0: "Grant" },
		});
		expect(late.ok).toBe(false);
		await runSlackTurn(thread, user, { text: "New request" });
		const conv = await collections.conversations.findOne({ _id: thread.conversationId });
		expect(conv?.mlBudget?.totalMicroUsd).toBe(0);
		expect(conv?.messages.at(-1)?.content).toContain("Handling the new request");
		expect(conv?.messages.at(-1)?.id).not.toBe(q.pending.messageId);
	});

	it("runs the real harness, asks a Slack question, applies its budget grant, and resumes using the configured token", async () => {
		const { thread, user } = await setup();
		rounds(
			{
				toolCalls: [
					{
						id: "ask-budget",
						name: "ask_user_question",
						arguments: JSON.stringify({
							questions: [
								{
									question: "Set a budget for the smoke test?",
									header: "Budget",
									multiSelect: false,
									options: [
										{ label: "Run", description: "Run the test", setBudgetUsd: 2 },
										{ label: "No compute", description: "Only write the script" },
									],
								},
							],
						}),
					},
				],
			},
			{ content: "I will use the approved budget." }
		);
		await runSlackTurn(thread, user, {
			text: "Create a demo for the model discussed in the thread.",
		});
		const question = await collections.mcpElicitations.findOne({
			conversationId: thread.conversationId,
			status: "pending",
		});
		if (!question) throw new Error("No question");
		expect(questionModal(question.request, thread._id).callback_id).toBe("ml_intern_answers");
		const answer = readAnswers(question.request, {
			q0: {
				answer: {
					type: "static_select",
					selected_option: { value: "0", text: { type: "plain_text", text: "0" } },
				},
			},
		});
		const result = await submitElicitationAnswer({
			conversationId: thread.conversationId,
			elicitationId: question.elicitationId,
			action: "accept",
			content: answer.content,
		});
		expect(result.ok).toBe(true);
		const identity = await rebuildIdentity({ userId: user._id });
		expect(identity.locals.token).toBe("hf-test-token");
		expect(identity.locals.billingOrganization).toBe("test-org");
		expect(identity.locals.publishNamespace).toBe("ML-Intern-lab");
		await kickAnsweredAsk(thread.conversationId, question.elicitationId);
		await expect
			.poll(
				async () =>
					await collections.generations.countDocuments({
						conversationId: thread.conversationId,
						status: "running",
					}),
				{ timeout: 10_000 }
			)
			.toBe(0);
		const conv = await collections.conversations.findOne({ _id: thread.conversationId });
		expect(conv?.mlBudget?.totalMicroUsd).toBe(2_000_000);
		expect(conv?.messages.at(-1)?.content).toContain("approved budget");
		expect(JSON.stringify(mocks.create.mock.calls[1][0].messages)).toContain("Set budget to $2.00");
		expect(
			await collections.sessions.countDocuments({ "oauth.token.value": "hf-test-token" })
		).toBe(0);
	});

	it("lets the owner's next message past an open review, which the new turn detaches", async () => {
		const { thread, user } = await setup();
		rounds(
			{
				toolCalls: [
					{
						id: "review",
						name: "request_review",
						arguments: JSON.stringify({
							title: "Sampled rows",
							source: { records: [{ id: "r1", text: "hello" }] },
							fields: [{ name: "text", type: "text" }],
						}),
					},
				],
			},
			{ content: "Answering the new request." }
		);
		await runSlackTurn(thread, user, { text: "Sample the dataset" });
		const row = await collections.mcpElicitations.findOne({
			conversationId: thread.conversationId,
			status: "pending",
		});
		if (row?.pending?.kind !== "review") throw new Error("No review");

		expect(await skipSlackQuestion(thread, user, row.pending.messageId, "next")).toBe(true);
		expect(await collections.mcpElicitations.findOne({ _id: row._id })).toMatchObject({
			status: "pending",
		});
		expect(
			(await collections.turnStates.findOne({ messageId: row.pending.messageId }))?.status
		).toBe("awaiting_input");

		await runSlackTurn(thread, user, { text: "Where do these rows come from?" });

		expect(await collections.mcpElicitations.findOne({ _id: row._id })).toMatchObject({
			resolution: "withdrawn",
			resume: { status: "abandoned" },
		});
		expect(
			(await collections.mlReviews.findOne({ conversationId: thread.conversationId }))?.status
		).toBe("detached");
		expect(JSON.stringify(mocks.create.mock.calls[1][0].messages)).toContain(
			'Review \\"Sampled rows\\" is still open'
		);
		const conv = await collections.conversations.findOne({ _id: thread.conversationId });
		expect(conv?.messages.at(-1)?.content).toContain("Answering the new request.");
	});

	it("stops a parked question without starting a continuation", async () => {
		const { thread, user } = await setup();
		rounds({
			toolCalls: [
				{
					id: "ask",
					name: "ask_user_question",
					arguments: JSON.stringify({
						questions: [
							{
								question: "Which demo?",
								header: "Demo",
								multiSelect: false,
								options: [
									{ label: "Gradio", description: "Interactive" },
									{ label: "Static", description: "HTML" },
								],
							},
						],
					}),
				},
			],
		});
		await runSlackTurn(thread, user, { text: "Build a demo" });
		await stopSlackTurn(thread, user);
		expect(
			await collections.mcpElicitations.countDocuments({
				conversationId: thread.conversationId,
				status: "pending",
			})
		).toBe(0);
		expect(
			(await collections.turnStates.findOne({ conversationId: thread.conversationId }))?.status
		).toBe("failed");
		expect(mocks.create).toHaveBeenCalledTimes(1);
	});
});

it("creates a zero-budget HF-owned chat and resumes its budget question with the same personal identity", async () => {
	const { user, session } = await createTestUser();
	await collections.sessions.updateOne(
		{ _id: session._id },
		{
			$set: {
				oauth: { token: { value: "hf-personal-test", expiresAt: new Date(Date.now() + 3600000) } },
			},
		}
	);
	await collections.slackConnections.insertOne({
		verifiedSlackIdentity: true,
		_id: "T123:U123",
		teamId: "T123",
		slackUserId: "U123",
		userId: user._id,
		sessionId: session.sessionId,
		updatedAt: new Date(),
	});
	const thread = await getOrCreateThread("T123", "C123", "200.0", "U123", user._id);
	await ensureConversation(thread, user, { ...mocks.settings, budgetUsd: 50 });
	let conv = await collections.conversations.findOne({ _id: thread.conversationId });
	expect(conv?.userId).toEqual(user._id);
	expect(conv?.mlBudget?.totalMicroUsd).toBe(0);
	rounds(
		{
			toolCalls: [
				{
					id: "budget",
					name: "ask_user_question",
					arguments: JSON.stringify({
						questions: [
							{
								header: "Budget",
								question: "Approve $1?",
								multiSelect: false,
								options: [
									{ label: "Approve", description: "One dollar", setBudgetUsd: 1 },
									{ label: "Skip", description: "No spending" },
								],
							},
						],
					}),
				},
			],
		},
		{ content: "Approved personal run." }
	);
	await runSlackTurn(thread, user, { text: "Run this with my account" });
	expect(mocks.create.mock.calls[0][1]?.headers?.Authorization).toBe("Bearer hf-personal-test");
	const q = await collections.mcpElicitations.findOne({
		conversationId: thread.conversationId,
		status: "pending",
	});
	if (!q) throw new Error("Missing question");
	const identity = await rebuildIdentity({ userId: user._id, sessionId: conv?.sessionId });
	expect(identity.locals.token).toBe("hf-personal-test");
	expect(identity.locals.billingOrganization).toBeUndefined();
	expect(identity.locals.publishNamespace).toBe(user.username);
	expect(
		(
			await submitElicitationAnswer({
				conversationId: thread.conversationId,
				elicitationId: q.elicitationId,
				action: "accept",
				content: readAnswers(q.request, {
					q0: {
						answer: {
							type: "static_select",
							selected_option: { value: "0", text: { type: "plain_text", text: "0" } },
						},
					},
				}).content,
			})
		).ok
	).toBe(true);
	await kickAnsweredAsk(thread.conversationId, q.elicitationId);
	await expect
		.poll(
			async () =>
				(await collections.conversations.findOne({ _id: thread.conversationId }))?.messages.at(-1)
					?.content
		)
		.toContain("Approved personal run");
	conv = await collections.conversations.findOne({ _id: thread.conversationId });
	expect(conv?.mlBudget?.totalMicroUsd).toBe(1000000);
});

it("allows an explicit retry of a failed input but deduplicates concurrent clicks", async () => {
	const { thread } = await setup();
	const input = {
		_id: "retry-test",
		threadId: thread._id,
		user: "U123",
		text: "",
		ts: "100.0",
		retry: true,
		expectedGenerationId: "original",
	};
	expect(await enqueueInput(input)).toBe(true);
	await collections.slackInputs.updateOne(
		{ _id: input._id },
		{ $set: { status: "failed", failureNotified: true, error: "429" } }
	);
	const results = await Promise.all([enqueueInput(input), enqueueInput(input)]);
	expect(results.filter(Boolean)).toHaveLength(1);
	const row = await collections.slackInputs.findOne({ _id: input._id });
	expect(row?.status).toBe("queued");
	expect(row?.error).toBeUndefined();
	expect(row?.failureNotified).toBeUndefined();
});
