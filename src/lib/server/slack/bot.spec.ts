import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestUser,
	createTestConversation,
} from "$lib/server/api/__tests__/testHelpers";
import { MlSlackBot } from "./bot";
import { skipSlackQuestion } from "./engine";
import {
	ANSWER_VIEW,
	RESUME_ACTION,
	STOP_ACTION,
	PICK_ACTION,
	SELECT_ACTION,
	SUBMIT_ACTION,
} from "./presentation";

type Handler = (args: Record<string, unknown>) => Promise<void>;
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, Handler>(),
	users: vi.fn(),
	channels: vi.fn(),
	replies: vi.fn(),
	post: vi.fn(),
	update: vi.fn(),
	ephemeral: vi.fn(),
	run: vi.fn(),
	react: vi.fn(),
	upload: vi.fn(),
}));
vi.mock("$lib/server/config", async (original) => {
	const m = await original<typeof import("$lib/server/config")>();
	return {
		...m,
		config: new Proxy(m.config, {
			get(target, key) {
				if (key === "PUBLIC_ORIGIN") return "https://huggingface.co";
				return Reflect.get(target, key);
			},
		}),
	};
});
vi.mock("@slack/bolt", () => ({
	App: class {
		client = {
			users: { info: mocks.users },
			files: { uploadV2: mocks.upload },
			reactions: { add: mocks.react },
			conversations: { info: mocks.channels, replies: mocks.replies },
			chat: { postMessage: mocks.post, postEphemeral: mocks.ephemeral, update: mocks.update },
		};
		event() {}
		action(id: string, handler: Handler) {
			mocks.handlers.set(id, handler);
		}
		view(id: string, handler: Handler) {
			mocks.handlers.set(id, handler);
		}
		error() {}
	},
}));
vi.mock("./engine", () => ({
	ensureConversation: vi.fn(),
	runSlackTurn: mocks.run,
	stopSlackTurn: vi.fn(),
	skipSlackQuestion: vi.fn().mockResolvedValue(false),
}));
const settings = {
	teamId: "T123",
	botToken: "xoxb-test",
	appToken: "xapp-test",
	hfToken: "hf-test",
	budgetUsd: 0,
	allowedChannels: [],
};

beforeEach(async () => {
	await ready;
	vi.clearAllMocks();
	mocks.handlers.clear();
	mocks.users.mockImplementation(async ({ user }: { user: string }) => ({
		user: { id: user, team_id: "T123" },
	}));
	mocks.ephemeral.mockResolvedValue({ ok: true });
	mocks.react.mockResolvedValue({ ok: true });
	mocks.post.mockImplementation(async () => ({ ts: crypto.randomUUID() }));
	mocks.channels.mockResolvedValue({ channel: { is_ext_shared: false } });
	mocks.replies.mockResolvedValue({ messages: [] });
});
afterEach(async () => {
	await cleanupTestData();
});

describe("Slack transport authorization", () => {
	it("lets another workspace member upload the trace only to its original channel thread", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Start", ts: "100.0" },
			"T123",
			"TRACE"
		);
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		await createTestConversation(locals, { _id: thread.conversationId });
		const handler = mocks.handlers.get("ml_intern_trace");
		if (!handler) throw Error("No handler");
		const args = {
			ack: vi.fn(),
			body: { user: { id: "OTHER" }, team: { id: "T123" }, channel: { id: "C123" } },
			action: { value: thread._id },
		};
		await handler(args);
		expect(mocks.upload).toHaveBeenCalledWith(
			expect.objectContaining({
				channel_id: "C123",
				thread_ts: "100.0",
				filename: `ml-intern-${thread.conversationId}.jsonl`,
			})
		);
		mocks.upload.mockClear();
		await handler({ ...args, body: { ...args.body, channel: { id: "C999" } } });
		await handler({ ...args, body: { ...args.body, team: { id: "T999" } } });
		mocks.users.mockResolvedValue({ user: { team_id: "T123", is_restricted: true } });
		await handler({ ...args, body: { ...args.body, user: { id: "GUEST" } } });
		mocks.channels.mockResolvedValue({ channel: { is_ext_shared: true } });
		await handler(args);
		expect(mocks.upload).not.toHaveBeenCalled();
	});
	it("keeps DM traces private to the owner", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "D123", user: "OWNER", text: "Start", ts: "100.0" },
			"T123",
			"DMTRACE"
		);
		const thread = await collections.slackThreads.findOne({});
		const handler = mocks.handlers.get("ml_intern_trace");
		if (!thread || !handler) throw Error("Missing setup");
		await handler({
			ack: vi.fn(),
			body: { user: { id: "OTHER" }, team: { id: "T123" }, channel: { id: "D123" } },
			action: { value: thread._id },
		});
		expect(mocks.upload).not.toHaveBeenCalled();
	});
	it("applies an inline grant only for the owner from a stored option, then shares it once", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Build", ts: "100.0" },
			"T123",
			"INLINE"
		);
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		await collections.slackInputs.updateMany({}, { $set: { status: "done" } });
		await createTestConversation(locals, {
			_id: thread.conversationId,
			mlAssistant: true,
			mlBudget: { totalMicroUsd: 0, spentMicroUsd: 0, reservations: [] },
		});
		const elicitationId = crypto.randomUUID();
		const now = new Date();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			conversationId: thread.conversationId,
			elicitationId,
			status: "pending",
			createdAt: now,
			updatedAt: now,
			pending: { kind: "ask", messageId: "m1", toolCallId: "c1", toolUuid: "u1" },
			request: {
				elicitationId,
				server: "",
				source: "assistant",
				mode: "form",
				message: "Budget?",
				fields: [
					{
						kind: "select",
						name: "q1",
						required: true,
						multiple: false,
						options: [{ value: "five", label: "Run", setBudgetUsd: 5 }],
					},
				],
			},
		});
		const handler = mocks.handlers.get(`${PICK_ACTION}0`);
		if (!handler) throw Error("Missing handler");
		const action = {
			value: JSON.stringify({
				threadId: thread._id,
				elicitationId,
				optionIndex: 0,
				setBudgetUsd: 999,
			}),
		};
		await handler({ ack: vi.fn(), body: { user: { id: "OTHER" }, team: { id: "T123" } }, action });
		expect(
			(await collections.conversations.findOne({ _id: thread.conversationId }))?.mlBudget
				?.totalMicroUsd
		).toBe(0);
		await handler({ ack: vi.fn(), body: { user: { id: "OWNER" }, team: { id: "T123" } }, action });
		expect(
			(await collections.conversations.findOne({ _id: thread.conversationId }))?.mlBudget
				?.totalMicroUsd
		).toBe(5000000);
		expect((await collections.mcpElicitations.findOne({ elicitationId }))?.slackShareAnswer).toBe(
			true
		);
		// Suppress execution: this test verifies the transport's durable answer delivery.
		await collections.slackInputs.updateMany({}, { $set: { status: "done" } });
		mocks.post.mockResolvedValue({ ts: "101.0" });
		await bot.tick();
		await bot.tick();
		const summaries = mocks.post.mock.calls.filter(([v]) =>
			v.text.startsWith("Questions answered")
		);
		expect(summaries).toHaveLength(1);
		expect(JSON.stringify(summaries[0][0].blocks)).toContain("Set budget to $5.00* ✅");
	});

	it("collects owner-only choices without spending, rejects stale submissions, and submits together", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Start", ts: "100.0" },
			"T123",
			"MULTI"
		);
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		await createTestConversation(locals, {
			_id: thread.conversationId,
			mlAssistant: true,
			mlBudget: { totalMicroUsd: 0, spentMicroUsd: 0, reservations: [] },
		});
		const elicitationId = crypto.randomUUID();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			conversationId: thread.conversationId,
			elicitationId,
			status: "pending",
			createdAt: new Date(),
			updatedAt: new Date(),
			pending: { kind: "ask", messageId: "m1", toolCallId: "c1", toolUuid: "u1" },
			request: {
				elicitationId,
				server: "",
				source: "assistant",
				mode: "form",
				message: "Choose",
				fields: [
					{
						kind: "select",
						name: "budget",
						required: true,
						multiple: false,
						options: [
							{ value: "five", label: "Five", setBudgetUsd: 5 },
							{ value: "zero", label: "Zero", setBudgetUsd: 0 },
						],
					},
					{
						kind: "select",
						name: "input",
						required: true,
						multiple: false,
						options: [
							{ value: "text", label: "Text" },
							{ value: "image", label: "Image" },
						],
					},
				],
			},
		});
		const select = async (f: number, i: number, user = "OWNER") => {
			const handler = mocks.handlers.get(`${SELECT_ACTION}${f}_${i}`);
			if (!handler) throw Error("Missing select");
			await handler({
				ack: vi.fn(),
				body: { user: { id: user }, team: { id: "T123" } },
				action: {
					value: JSON.stringify({
						threadId: thread._id,
						elicitationId,
						fieldIndex: f,
						optionIndex: i,
					}),
				},
			});
		};
		const submit = async (revision: number, user = "OWNER") => {
			const handler = mocks.handlers.get(SUBMIT_ACTION);
			if (!handler) throw Error("Missing submit");
			await handler({
				ack: vi.fn(),
				body: { user: { id: user }, team: { id: "T123" } },
				action: { value: JSON.stringify({ threadId: thread._id, elicitationId, revision }) },
			});
		};
		await select(0, 0, "OTHER");
		expect(
			(await collections.mcpElicitations.findOne({ elicitationId }))?.slackChoices
		).toBeUndefined();
		await select(0, 0);
		await submit(1);
		expect((await collections.mcpElicitations.findOne({ elicitationId }))?.status).toBe("pending");
		await select(1, 0);
		await submit(2, "OTHER");
		await select(1, 1);
		await submit(2);
		expect(
			(await collections.conversations.findOne({ _id: thread.conversationId }))?.mlBudget
				?.totalMicroUsd
		).toBe(0);
		await submit(3);
		const q = await collections.mcpElicitations.findOne({ elicitationId });
		expect(q?.content).toEqual({ budget: "five", input: "image" });
		expect(q?.status).toBe("resolved");
		expect(
			(await collections.conversations.findOne({ _id: thread.conversationId }))?.mlBudget
				?.totalMicroUsd
		).toBe(5000000);
	});

	it("refreshes selections immediately and posts continuation below immutable questions and answers", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Ask", ts: "100.0" },
			"T123",
			"RENDER"
		);
		await collections.slackInputs.updateMany({}, { $set: { status: "done" } });
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		const messageId = crypto.randomUUID(),
			generationId = crypto.randomUUID(),
			elicitationId = crypto.randomUUID();
		await createTestConversation(locals, {
			_id: thread.conversationId,
			messages: [
				{
					id: messageId,
					generationId,
					from: "assistant",
					content: "Questions",
					createdAt: new Date(),
				},
			],
		});
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId: thread.conversationId,
			messageId,
			producerId: generationId,
			status: "awaiting_input",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			conversationId: thread.conversationId,
			generationId,
			elicitationId,
			status: "pending",
			createdAt: new Date(),
			updatedAt: new Date(),
			pending: { kind: "ask", messageId, toolCallId: "c", toolUuid: "u" },
			request: {
				elicitationId,
				source: "assistant",
				server: "",
				mode: "form",
				message: "Questions",
				fields: [0, 1].map((i) => ({
					kind: "select" as const,
					name: `q${i}`,
					required: true,
					multiple: false,
					options: [
						{ value: "a", label: "Alpha" },
						{ value: "b", label: "Beta" },
					],
				})),
			},
		});
		let posted = 100;
		mocks.post.mockImplementation(async () => ({ ts: `${posted++}.0` }));
		const select = async (index: number) => {
			const handler = mocks.handlers.get(`${SELECT_ACTION}0_${index}`);
			if (!handler) throw Error("No select");
			await handler({
				ack: vi.fn(),
				body: { user: { id: "OWNER" }, team: { id: "T123" } },
				action: {
					value: JSON.stringify({
						threadId: thread._id,
						elicitationId,
						fieldIndex: 0,
						optionIndex: index,
					}),
				},
			});
		};
		await bot["render"](thread);
		await select(0);
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ ts: "102.0", blocks: expect.any(Array) })
		);
		expect(JSON.stringify(mocks.update.mock.calls.at(-1))).toContain("✓ A. Alpha");
		await select(1);
		expect(JSON.stringify(mocks.update.mock.calls.at(-1))).toContain("✓ B. Beta");
		// Simulate the harness resolving and resuming in the same assistant message.
		expect(mocks.post.mock.calls[0][0].text).toContain("Session status");
		expect(mocks.post.mock.calls[1][0].text).toContain("Run updates");
		expect(mocks.post.mock.calls[1][0].text).toContain("Questions");
		expect(
			mocks.post.mock.calls[2][0].blocks.some((b: { type: string }) => b.type === "actions")
		).toBe(true);
		mocks.post.mockClear();
		await collections.mcpElicitations.updateOne(
			{ elicitationId },
			{
				$set: {
					status: "resolved",
					action: "accept",
					resolution: "user",
					slackShareAnswer: true,
					content: { q0: "b", q1: "a" },
				},
			}
		);
		await collections.conversations.updateOne(
			{ _id: thread.conversationId },
			{
				$set: {
					"messages.0.generationId": crypto.randomUUID(),
					"messages.0.content": "Questions",
				},
			}
		);

		await bot["render"](thread);
		expect(mocks.post.mock.calls.some(([v]) => v.text.includes("Answers from"))).toBe(false);
		expect(mocks.post).not.toHaveBeenCalled();
		expect(mocks.post.mock.calls.some(([v]) => v.text.includes("Run updates"))).toBe(false);
		await collections.conversations.updateOne(
			{ _id: thread.conversationId },
			{ $set: { "messages.0.content": "Questions\n\nHere is the follow-up response" } }
		);
		await bot["render"](thread);
		expect(mocks.post.mock.calls[0][0].text).toContain("Here is the follow-up response");
		expect(mocks.post.mock.calls[0][0].text).not.toContain("Questions");
		await collections.turnStates.updateOne({ messageId }, { $set: { status: "done" } });
		await bot["render"](thread);
		expect(mocks.post.mock.calls[1][0].text).toContain("Here is the follow-up response");
		expect(mocks.post.mock.calls[1][0].text).not.toContain("Questions");
		expect(
			mocks.update.mock.calls.some(([v]) => v.ts === "102.0" && v.text.includes("follow-up"))
		).toBe(false);
		expect(
			mocks.update.mock.calls
				.filter(([v]) => v.text.includes("Session status"))
				.every(([v]) => v.ts === "100.0")
		).toBe(true);
		expect(
			mocks.update.mock.calls.some(([v]) => v.ts === "100.0" && v.text.includes("Finished"))
		).toBe(true);
		const frozen = mocks.update.mock.calls.find(([v]) => v.text.startsWith("Questions answered"));
		expect(JSON.stringify(frozen?.[0].blocks)).toContain("*Beta* ✅");
		expect(JSON.stringify(frozen?.[0].blocks)).toContain("*Alpha* ✅");
		expect(frozen?.[0].blocks.at(-1)).toEqual({ type: "divider" });
		expect(frozen?.[0].blocks.some((b: { type: string }) => b.type === "actions")).toBe(false);
		await collections.slackThreads.updateOne({ _id: thread._id }, { $set: { watching: true } });
		await bot.tick();
		expect(mocks.post).toHaveBeenCalledTimes(2);
	});
	it("creates a new status for a follow-up invocation and keeps earlier status unchanged", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "First", ts: "100.0" },
			"T123",
			"STATUS1"
		);
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		const first = { id: crypto.randomUUID(), from: "assistant" as const, content: "First result" };
		await createTestConversation(locals, { _id: thread.conversationId, messages: [first] });
		mocks.post.mockResolvedValueOnce({ ts: "101.0" }).mockResolvedValueOnce({ ts: "201.0" });
		await bot["publishSessionStatus"](thread, "✅ Finished", []);
		const second = { ...first, id: crypto.randomUUID(), content: "Second result" };
		await collections.conversations.updateOne(
			{ _id: thread.conversationId },
			{ $push: { messages: second } }
		);
		await bot["publishSessionStatus"](thread, "🕐 Working for 0s", []);
		// A resumed generation keeps the same assistant message and updates its own card.
		await bot["publishSessionStatus"](thread, "🕑 Running for 10s", []);
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(mocks.update.mock.calls[0][0].ts).toBe("201.0");
		expect(await collections.slackDeliveries.countDocuments({ threadId: thread._id })).toBe(2);
	});

	it("only lets the owner replace a pending question with a new request", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Start", ts: "100.0" },
			"T123",
			"start"
		);
		await collections.slackInputs.updateMany({}, { $set: { status: "done" } });
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		const messageId = crypto.randomUUID();
		await createTestConversation(locals, {
			_id: thread.conversationId,
			messages: [{ id: messageId, from: "assistant", content: "Question" }],
		});
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId: thread.conversationId,
			messageId,
			producerId: crypto.randomUUID(),
			status: "awaiting_input",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await bot.receive(
			{ channel: "C123", user: "OTHER", text: "New", ts: "101.0", thread_ts: "100.0" },
			"T123",
			"other"
		);
		await bot["dispatch"](thread);
		expect(skipSlackQuestion).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(mocks.ephemeral.mock.lastCall?.[0].thread_ts).toBe("100.0");
		vi.mocked(skipSlackQuestion).mockResolvedValueOnce(true);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Move on", ts: "102.0", thread_ts: "100.0" },
			"T123",
			"owner"
		);
		await bot["dispatch"](thread);
		expect(skipSlackQuestion).toHaveBeenCalledTimes(1);
		expect(mocks.run).toHaveBeenCalledTimes(1);
		expect(mocks.run.mock.lastCall?.[2].text).toContain("Move on");
	});

	it("acknowledges a received request before generation and deduplicates Slack retries", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		const event = { channel: "C123", user: "OWNER", text: "Research this", ts: "100.0" };
		await bot.receive(event, "T123", "ACK1");
		await bot.receive(event, "T123", "ACK1");
		expect(mocks.react).toHaveBeenCalledTimes(1);
		expect(mocks.react).toHaveBeenCalledWith({ channel: "C123", timestamp: "100.0", name: "eyes" });
		expect(mocks.ephemeral).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
		expect(await collections.slackInputs.countDocuments({ status: "queued" })).toBe(1);
	});

	it("reacts to the invoking reply and keeps requests queued if Slack reactions fail", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		mocks.react.mockRejectedValueOnce(new Error("missing_scope"));
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Hello", ts: "101.0", thread_ts: "100.0" },
			"T123",
			"REACT"
		);
		expect(mocks.react).toHaveBeenCalledWith({ channel: "C123", timestamp: "101.0", name: "eyes" });
		expect(await collections.slackInputs.countDocuments({ status: "queued" })).toBe(1);
		expect(mocks.ephemeral).not.toHaveBeenCalled();
		expect(mocks.run).not.toHaveBeenCalled();
	});
	it("runs different users' threads concurrently without sharing prompts or conversations", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.run.mockImplementation(() => held);
		await bot.receive(
			{ channel: "C123", user: "ALICE", text: "ALPHA private context", ts: "100.0" },
			"T123",
			"E1"
		);
		await bot.receive(
			{ channel: "C123", user: "BOB", text: "BETA private context", ts: "200.0" },
			"T123",
			"E2"
		);
		try {
			await bot.tick();
			await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
			const calls = mocks.run.mock.calls;
			expect(calls[0][0].conversationId.toString()).not.toBe(calls[1][0].conversationId.toString());
			for (const [thread, , input] of calls) {
				expect(input.text).toContain(thread.owner === "ALICE" ? "ALPHA" : "BETA");
				expect(input.text).not.toContain(thread.owner === "ALICE" ? "BETA" : "ALPHA");
			}
		} finally {
			release?.();
		}
		await vi.waitFor(async () =>
			expect(await collections.slackInputs.countDocuments({ status: "done" })).toBe(2)
		);
	});
	it("retains public updates across new output, retries and bot restarts without leaking reasoning", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive(
			{ channel: "C123", user: "OWNER", text: "Train", ts: "100.0" },
			"T123",
			"UPDATES"
		);
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		mocks.post.mockResolvedValue({ ts: "201.0" });
		const first = "Trackio: https://example.com/metrics\n\nValidation accuracy: 98%.";
		await bot["publishPublicUpdates"](
			thread,
			"updates-test",
			"message",
			`<think>secret</think>${first}`
		);
		expect(mocks.post).toHaveBeenCalledTimes(1);
		const restarted = new MlSlackBot(settings, user);
		await restarted["publishPublicUpdates"](
			thread,
			"updates-test",
			"message",
			`${first}\n\nUploading weights.`
		);
		expect(mocks.update.mock.lastCall?.[0].text).toContain(first);
		expect(mocks.update.mock.lastCall?.[0].text).toContain("Uploading weights.");
		await restarted["publishPublicUpdates"](
			thread,
			"updates-test",
			"message",
			"Deployment ready.<think>private"
		);
		const text = mocks.update.mock.lastCall?.[0].text;
		expect(text).toContain(first);
		expect(text).toContain("Uploading weights.");
		expect(text).toContain("Deployment ready.");
		expect(text).not.toMatch(/secret|private/);
		await restarted["publishPublicUpdates"](
			thread,
			"updates-test",
			"message",
			"Deployment ready.<think>private"
		);
		expect(mocks.update).toHaveBeenCalledTimes(2);
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});

	it("posts the private stop confirmation inside the stopped thread", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive({ channel: "C123", user: "OWNER", text: "Run", ts: "100.0" }, "T123", "STOP");
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw Error("No thread");
		const messageId = crypto.randomUUID(),
			generationId = crypto.randomUUID();
		await createTestConversation(locals, {
			_id: thread.conversationId,
			messages: [{ id: messageId, generationId, from: "assistant", content: "Working" }],
		});
		const handler = mocks.handlers.get(STOP_ACTION);
		if (!handler) throw Error("No handler");
		await handler({
			ack: vi.fn(),
			body: { user: { id: "OWNER" }, team: { id: "T123" } },
			action: { value: JSON.stringify({ threadId: thread._id, messageId, generationId }) },
		});
		expect(mocks.ephemeral).toHaveBeenCalledWith({
			channel: "C123",
			user: "OWNER",
			thread_ts: "100.0",
			text: expect.stringContaining("Stopped the assistant."),
		});
	});

	it("refuses a stale Resume button rather than replaying a newer completed turn", async () => {
		const { user, locals } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive({ channel: "C123", user: "OWNER", text: "Build", ts: "100.0" }, "T123", "E1");
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw new Error("No thread");
		const latest = {
			id: crypto.randomUUID(),
			generationId: crypto.randomUUID(),
			from: "assistant" as const,
			content: "Completed successfully",
		};
		await createTestConversation(locals, { _id: thread.conversationId, messages: [latest] });
		const handler = mocks.handlers.get(RESUME_ACTION);
		if (!handler) throw new Error("No handler");
		await handler({
			ack: vi.fn(),
			body: { user: { id: "OWNER" }, team: { id: "T123" } },
			action: {
				value: JSON.stringify({
					threadId: thread._id,
					messageId: crypto.randomUUID(),
					generationId: crypto.randomUUID(),
				}),
			},
		});
		expect(await collections.slackInputs.countDocuments({})).toBe(1);
	});

	it("accepts one durable request for redelivered mentions and preserves the original invoker", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		const event = {
			channel: "C123",
			user: "U123",
			text: "Build the model discussed here",
			ts: "100.1",
			thread_ts: "100.0",
		};
		await bot.receive(event, "T123", "E1");
		await bot.receive(event, "T123", "E1");
		await bot.receive({ ...event, user: "U999", ts: "100.2" }, "T123", "E2");
		expect(await collections.slackInputs.countDocuments({})).toBe(2);
		expect(await collections.slackThreads.countDocuments({})).toBe(1);
		expect((await collections.slackThreads.findOne({}))?.owner).toBe("U123");
		expect(mocks.react).toHaveBeenCalledTimes(2);
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("dispatches another member's request in the owner's conversation with correct attribution", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		mocks.run.mockResolvedValue(undefined);
		await bot.receive(
			{ channel: "C123", user: "ALICE", text: "Start", ts: "100.0" },
			"T123",
			"SHARED1"
		);
		await bot.tick();
		await vi.waitFor(async () =>
			expect(await collections.slackInputs.countDocuments({ status: "done" })).toBe(1)
		);
		await bot.receive(
			{
				channel: "C123",
				thread_ts: "100.0",
				user: "BOB",
				text: "Compare another model",
				ts: "101.0",
			},
			"T123",
			"SHARED2"
		);
		await bot.tick();
		await vi.waitFor(async () =>
			expect(await collections.slackInputs.countDocuments({ status: "done" })).toBe(2)
		);
		expect(mocks.run).toHaveBeenCalledTimes(2);
		const [first, second] = mocks.run.mock.calls;
		expect(second[0].conversationId).toEqual(first[0].conversationId);
		expect(second[0].owner).toBe("ALICE");
		expect(second[2].text).toContain("invoking Slack user is BOB");
		expect(second[2].text).toContain("task owner is ALICE");
		expect(second[2].text).toContain("Compare another model");
	});
	it("rejects other workspaces, guests, bot events and external channels before queuing work", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		const event = { channel: "C123", user: "U123", text: "Run training", ts: "100.0" };
		await bot.receive(event, "T999", "E1");
		await bot.receive({ ...event, bot_id: "B1" }, "T123", "E2");
		mocks.users.mockResolvedValue({ user: { team_id: "T123", is_restricted: true } });
		await bot.receive({ ...event, user: "GUEST" }, "T123", "E3");
		mocks.users.mockResolvedValue({ user: { team_id: "T123" } });
		mocks.channels.mockResolvedValue({ channel: { is_ext_shared: true } });
		await bot.receive(event, "T123", "E4");
		expect(await collections.slackInputs.countDocuments({})).toBe(0);
	});
	it("does not let another member submit the owner's question or budget grant", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot(settings, user);
		await bot.receive({ channel: "C123", user: "OWNER", text: "Build", ts: "100.0" }, "T123", "E1");
		const thread = await collections.slackThreads.findOne({});
		if (!thread) throw new Error("No thread");
		const handler = mocks.handlers.get(ANSWER_VIEW);
		if (!handler) throw new Error("No handler");
		const ack = vi.fn();
		await handler({
			ack,
			body: { user: { id: "OTHER" }, team: { id: "T123" } },
			view: {
				private_metadata: JSON.stringify({
					threadId: thread._id,
					elicitationId: crypto.randomUUID(),
				}),
				state: { values: {} },
			},
		});
		expect(ack).toHaveBeenCalledWith({ response_action: "clear" });
		expect(await collections.slackInputs.countDocuments({})).toBe(1);
	});
	it("applies the channel allowlist to DMs too", async () => {
		const { user } = await createTestUser();
		const bot = new MlSlackBot({ ...settings, allowedChannels: ["C123"] }, user);
		await bot.receive({ channel: "D123", user: "U123", text: "Build", ts: "100.0" }, "T123", "E1");
		expect(await collections.slackInputs.countDocuments({})).toBe(0);
		expect(mocks.users).not.toHaveBeenCalled();
	});
});

it("privately asks an unconnected user to connect, without queueing a paid session", async () => {
	const bot = new MlSlackBot({ ...settings, accountMode: "user", hfToken: "" });
	await bot.receive(
		{ user: "U123", channel: "C123", ts: "500.0", text: "Train a model" },
		"T123",
		"link-event"
	);
	expect(mocks.ephemeral).toHaveBeenCalledWith(
		expect.objectContaining({
			user: "U123",
			channel: "C123",
			thread_ts: "500.0",
			text: expect.stringContaining("Connect Hugging Face"),
		})
	);
	expect(mocks.post).not.toHaveBeenCalled();
	expect(await collections.slackInputs.countDocuments({})).toBe(0);
	expect(await collections.slackThreads.countDocuments({})).toBe(0);
});
