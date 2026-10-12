import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestUser,
	createTestConversation,
} from "$lib/server/api/__tests__/testHelpers";
import { MlSlackBot } from "./bot";
import { ANSWER_VIEW, RESUME_ACTION } from "./presentation";

type Handler = (args: Record<string, unknown>) => Promise<void>;
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, Handler>(),
	users: vi.fn(),
	channels: vi.fn(),
	replies: vi.fn(),
	post: vi.fn(),
	ephemeral: vi.fn(),
	run: vi.fn(),
}));
vi.mock("@slack/bolt", () => ({
	App: class {
		client = {
			users: { info: mocks.users },
			conversations: { info: mocks.channels, replies: mocks.replies },
			chat: { postMessage: mocks.post, postEphemeral: mocks.ephemeral },
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
	mocks.channels.mockResolvedValue({ channel: { is_ext_shared: false } });
	mocks.replies.mockResolvedValue({ messages: [] });
});
afterEach(async () => {
	await cleanupTestData();
});

describe("Slack transport authorization", () => {
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
		await bot.receive({ ...event, user: "U999" }, "T123", "E2");
		expect(await collections.slackInputs.countDocuments({})).toBe(1);
		expect((await collections.slackThreads.findOne({}))?.owner).toBe("U123");
		expect(mocks.ephemeral).toHaveBeenCalledWith(expect.objectContaining({ user: "U999" }));
		expect(mocks.run).not.toHaveBeenCalled();
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
