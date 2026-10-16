import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { ParkedCall } from "$lib/types/ParkedCall";
import { waitResumeResultText } from "$lib/server/textGeneration/builtinTools/waitTool";
import {
	MAX_QUEUED_INPUTS,
	QueueFullError,
	cancelQueuedInput,
	claimQueuedInputs,
	enqueueInput,
	listQueuedInputs,
	releaseQueuedInputs,
} from "./store";
import { takeQueuedInputs, wakeParkForQueuedInput } from "./deliver";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));

const generate = vi.fn();
vi.mock("$lib/server/generation/conversationRequest", () => ({
	generateConversationResponse: (...args: unknown[]) => generate(...args),
}));
vi.mock("$lib/server/generation/parkedSweeper", () => ({
	rebuildIdentity: async () => ({
		locals: { sessionId: "s" },
		settings: null,
		tokenExpired: false,
	}),
}));

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	const filter = { conversationId: { $in: conversationIds } };
	await Promise.all([
		collections.queuedInputs.deleteMany(filter),
		collections.parkedCalls.deleteMany(filter),
		collections.generations.deleteMany(filter),
		collections.turnStates.deleteMany(filter),
		collections.conversations.deleteMany({ _id: { $in: conversationIds } }),
		collections.semaphores.deleteMany({ key: { $regex: "^queue\\.drain:" } }),
	]);
	conversationIds.length = 0;
	generate.mockReset();
});

function conversation(): ObjectId {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
}

const queue = (conversationId: ObjectId, text: string) =>
	enqueueInput({ conversationId, text, source: "web", sessionId: "s" });

describe.sequential("queued inputs", () => {
	it("hands each message to one taker, oldest first", async () => {
		const conversationId = conversation();
		await queue(conversationId, "first");
		await queue(conversationId, "second");

		const [taken, again] = await Promise.all([
			claimQueuedInputs(conversationId, { status: "delivered", messageId: "a1" }),
			claimQueuedInputs(conversationId, { status: "delivered", messageId: "a1" }),
		]);

		expect([...taken, ...again].map((row) => row.text).sort()).toEqual(["first", "second"]);
		expect(taken.length + again.length).toBe(2);
		const stored = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(stored.every((row) => row.status === "delivered" && row.messageId === "a1")).toBe(true);
	});

	it("lets a cancel win or lose whole against a take", async () => {
		const conversationId = conversation();
		const kept = await queue(conversationId, "keep");
		const dropped = await queue(conversationId, "drop");

		expect(await cancelQueuedInput(conversationId, dropped._id)).toBe(true);
		const taken = await claimQueuedInputs(conversationId, { status: "started" });
		expect(taken.map((row) => row.text)).toEqual(["keep"]);
		expect(await cancelQueuedInput(conversationId, kept._id)).toBe(false);
	});

	it("refuses past the queue limit", async () => {
		const conversationId = conversation();
		for (let i = 0; i < MAX_QUEUED_INPUTS; i += 1) await queue(conversationId, `m${i}`);
		await expect(queue(conversationId, "one too many")).rejects.toBeInstanceOf(QueueFullError);
	});

	it("puts refused starts back, and gives up after three", async () => {
		const conversationId = conversation();
		await queue(conversationId, "retry me");
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const rows = await claimQueuedInputs(conversationId, { status: "started" });
			expect(rows).toHaveLength(1);
			await releaseQueuedInputs(rows);
		}
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row.status).toBe("cancelled");
		expect(row.attempts).toBe(3);
	});

	it("lists what is queued and what a turn took lately", async () => {
		const conversationId = conversation();
		await queue(conversationId, "taken");
		await claimQueuedInputs(conversationId, { status: "started" });
		await queue(conversationId, "waiting");
		const cancelled = await queue(conversationId, "gone");
		await cancelQueuedInput(conversationId, cancelled._id);

		const listed = await listQueuedInputs(conversationId);
		expect(listed.map(({ text, status }) => ({ text, status }))).toEqual([
			{ text: "taken", status: "started" },
			{ text: "waiting", status: "queued" },
		]);
	});

	it("builds the update the turn yields, with the text the model reads", async () => {
		const conversationId = conversation();
		const row = await queue(conversationId, "also try lr 1e-4");

		const update = await takeQueuedInputs(conversationId, "a1", "tool-uuid");

		expect(update).toMatchObject({
			type: MessageUpdateType.QueuedInput,
			afterToolUuid: "tool-uuid",
			inputs: [{ id: row._id.toString(), text: "also try lr 1e-4" }],
		});
		expect(update?.text).toMatch(/^\[The user sent this while you were working\./);
		expect(update?.text).toContain("<user_message>\nalso try lr 1e-4\n</user_message>");
		expect(await takeQueuedInputs(conversationId, "a1", "tool-uuid")).toBeUndefined();
	});
});

describe.sequential("waking a wait for a queued message", () => {
	const park = async (conversationId: ObjectId, createdAt: Date, resumeAt: Date) => {
		const row: ParkedCall = {
			_id: new ObjectId(),
			parkedCallId: new ObjectId().toString(),
			conversationId,
			messageId: "a1",
			toolCallId: "call",
			toolUuid: "uuid",
			kind: "timer",
			status: "waiting",
			resumeAt,
			reason: "training",
			attempts: 0,
			createdAt,
			updatedAt: createdAt,
		};
		await collections.parkedCalls.insertOne(row);
		return row;
	};

	it("brings a long wait forward and says why on resume", async () => {
		const conversationId = conversation();
		const createdAt = new Date(Date.now() - 60_000);
		const resumeAt = new Date(Date.now() + 30 * 60_000);
		await park(conversationId, createdAt, resumeAt);

		expect(await wakeParkForQueuedInput(conversationId)).toBe(true);
		const woken = await collections.parkedCalls.findOne({ conversationId });
		expect(woken?.resumeAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(woken?.plannedResumeAt?.getTime()).toBe(resumeAt.getTime());
		expect(woken?.wokeByUserMessageAt).toBeInstanceOf(Date);
		expect(woken && waitResumeResultText(woken)).toMatch(/because the user sent a message/);
	});

	it("waits out the save grace of a wait that just parked", async () => {
		const conversationId = conversation();
		const createdAt = new Date();
		await park(conversationId, createdAt, new Date(Date.now() + 30 * 60_000));

		await wakeParkForQueuedInput(conversationId);
		const woken = await collections.parkedCalls.findOne({ conversationId });
		expect(woken?.resumeAt.getTime()).toBe(createdAt.getTime() + 15_000);
	});

	it("leaves a wait that is already due alone", async () => {
		const conversationId = conversation();
		const resumeAt = new Date(Date.now() - 1_000);
		await park(conversationId, new Date(Date.now() - 60_000), resumeAt);

		await wakeParkForQueuedInput(conversationId);
		const woken = await collections.parkedCalls.findOne({ conversationId });
		expect(woken?.resumeAt.getTime()).toBe(resumeAt.getTime());
		expect(woken?.wokeByUserMessageAt).toBeUndefined();
	});
});

describe.sequential("starting the next turn from the queue", async () => {
	const { startQueuedTurn } = await import("./drain");

	const seedConversation = async (conversationId: ObjectId, mlAssistant = true) => {
		const now = new Date();
		await collections.conversations.insertOne({
			_id: conversationId,
			sessionId: "s",
			model: "m",
			title: "t",
			mlAssistant,
			rootMessageId: "root",
			messages: [
				{ id: "root", from: "system", content: "", createdAt: now, updatedAt: now },
				{ id: "a1", from: "assistant", content: "done", createdAt: now, updatedAt: now },
			],
			createdAt: now,
			updatedAt: now,
		} as never);
	};

	const streamingResponse = () =>
		new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("{}\n"));
					controller.close();
				},
			})
		);

	it("runs everything queued as one message under the last one", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "first");
		await queue(conversationId, "second");
		generate.mockResolvedValue(streamingResponse());

		expect(await startQueuedTurn(conversationId)).toBe("started");

		expect(generate).toHaveBeenCalledTimes(1);
		const [{ request, params }] = generate.mock.calls[0] as [
			{ request: Request; params: { id: string } },
		];
		expect(params.id).toBe(conversationId.toHexString());
		const body = JSON.parse(String((await request.formData()).get("data")));
		expect(body).toMatchObject({ inputs: "first\n\nsecond", id: "a1" });
		const rows = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(rows.every((row) => row.status === "started")).toBe(true);
	});

	it("leaves the queue to a turn that is still running", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "later");
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: "g",
			conversationId,
			messageId: "a1",
			status: "running",
			startedAt: new Date(),
			lastHeartbeatAt: new Date(),
		} as never);

		expect(await startQueuedTurn(conversationId)).toBe("busy");
		expect(generate).not.toHaveBeenCalled();
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row.status).toBe("queued");
	});

	it("starts once when two callers race", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "once");
		generate.mockResolvedValue(streamingResponse());

		const outcomes = await Promise.all([
			startQueuedTurn(conversationId),
			startQueuedTurn(conversationId),
		]);

		expect(outcomes.filter((outcome) => outcome === "started")).toHaveLength(1);
		expect(generate).toHaveBeenCalledTimes(1);
	});

	it("puts the messages back when the turn is refused", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "refused");
		generate.mockRejectedValue(new Error("429"));

		expect(await startQueuedTurn(conversationId)).toBe("failed");
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row).toMatchObject({ status: "queued", attempts: 1 });
	});

	it("drops a queue whose conversation left ML Intern", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId, false);
		await queue(conversationId, "nowhere");

		expect(await startQueuedTurn(conversationId)).toBe("empty");
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row.status).toBe("cancelled");
	});
});
