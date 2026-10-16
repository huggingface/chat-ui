import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { ParkedCall } from "$lib/types/ParkedCall";
import { waitResumeResultText } from "$lib/server/textGeneration/builtinTools/waitTool";
import {
	MAX_QUEUED_INPUTS,
	QueueFullError,
	QueuedInputTooLongError,
	cancelAllQueuedInputs,
	cancelQueuedInput,
	claimQueuedInputs,
	enqueueInput,
	listQueuedInputs,
	queuedInputCharLimit,
	releaseQueuedInputs,
} from "./store";
import { takeQueuedInputs, wakeParkForQueuedInput } from "./deliver";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));

const generate = vi.fn();
vi.mock("$lib/server/generation/conversationRequest", () => ({
	generateConversationResponse: (...args: unknown[]) => generate(...args),
}));
const identity = vi.hoisted(() => ({ tokenExpired: false }));
vi.mock("$lib/server/generation/parkedSweeper", () => ({
	rebuildIdentity: async () => ({
		locals: { sessionId: "s" },
		settings: null,
		tokenExpired: identity.tokenExpired,
	}),
}));
const userToken = vi.hoisted(() => ({ value: "false" }));
vi.mock("$lib/server/config", async (importOriginal) => {
	const original = await importOriginal<typeof import("$lib/server/config")>();
	return {
		...original,
		config: new Proxy(original.config, {
			get: (target, key) => (key === "USE_USER_TOKEN" ? userToken.value : Reflect.get(target, key)),
		}),
	};
});

beforeAll(async () => {
	await ready;
	// the turn start lock relies on it, and a fresh test database builds it in the background
	await collections.semaphores.createIndex({ key: 1 }, { unique: true });
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
		collections.semaphores.deleteMany({
			key: { $in: conversationIds.map((id) => `queue.drain:${id.toString()}`) },
		}),
	]);
	conversationIds.length = 0;
	generate.mockReset();
	identity.tokenExpired = false;
	userToken.value = "false";
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

	it("refuses past the queue limit, even when sends race", async () => {
		const conversationId = conversation();
		const results = await Promise.allSettled(
			Array.from({ length: MAX_QUEUED_INPUTS + 4 }, (_, i) => queue(conversationId, `m${i}`))
		);
		const refused = results.filter((result) => result.status === "rejected");
		expect(refused.length).toBeGreaterThanOrEqual(4);
		expect(
			refused.every(
				(result) => result.status === "rejected" && result.reason instanceof QueueFullError
			)
		).toBe(true);
		const queued = await collections.queuedInputs.countDocuments({
			conversationId,
			status: "queued",
		});
		expect(queued).toBeLessThanOrEqual(MAX_QUEUED_INPUTS);
	});

	it("refuses a message past the char limit wherever it comes from", async () => {
		const conversationId = conversation();
		await expect(
			enqueueInput({
				conversationId,
				text: "x".repeat(queuedInputCharLimit() + 1),
				source: "slack",
			})
		).rejects.toBeInstanceOf(QueuedInputTooLongError);
	});

	it("takes no more than fits in one message and leaves the rest queued", async () => {
		const conversationId = conversation();
		const half = "y".repeat(Math.floor(queuedInputCharLimit() / 2));
		await queue(conversationId, half);
		await queue(conversationId, half);
		await queue(conversationId, "third");

		const first = await claimQueuedInputs(conversationId, { status: "started" });
		expect(first).toHaveLength(1);
		const second = await claimQueuedInputs(conversationId, { status: "started" });
		expect(second.map((row) => row.text)).toEqual([half, "third"]);
	});

	it("puts refused starts back, then fails them with the reason after three", async () => {
		const conversationId = conversation();
		await queue(conversationId, "retry me");
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const rows = await claimQueuedInputs(conversationId, { status: "started" });
			expect(rows).toHaveLength(1);
			await releaseQueuedInputs(rows, "rate limited");
		}
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row).toMatchObject({ status: "failed", error: "rate limited", attempts: 3 });
		expect(await listQueuedInputs(conversationId)).toMatchObject([
			{ status: "failed", error: "rate limited", text: "retry me" },
		]);
	});

	it("reports only the rows a stop cancelled", async () => {
		const conversationId = conversation();
		const taken = await queue(conversationId, "taken");
		await claimQueuedInputs(conversationId, { status: "started" });
		const left = await queue(conversationId, "left");

		expect(await cancelAllQueuedInputs(conversationId)).toEqual([left._id.toString()]);
		expect(await collections.queuedInputs.findOne({ _id: taken._id })).toMatchObject({
			status: "started",
		});
	});

	it("keeps every queued row in the listing however much history there is", async () => {
		const conversationId = conversation();
		for (let i = 0; i < 25; i += 1) {
			await queue(conversationId, `old ${i}`);
			await claimQueuedInputs(conversationId, { status: "delivered", messageId: "a1" });
		}
		await queue(conversationId, "newest");

		const listed = await listQueuedInputs(conversationId);
		expect(listed.at(-1)).toMatchObject({ text: "newest", status: "queued" });
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
	const { claimTurnStart, startQueuedTurn, sweepQueuedInputs } = await import("./drain");

	const awaitingInput = (conversationId: ObjectId) =>
		collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId,
			messageId: "a1",
			producerId: "p",
			status: "awaiting_input",
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);

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
		const [{ getClientAddress }] = generate.mock.calls[0] as [{ getClientAddress: () => string }];
		expect(getClientAddress()).toBe("queue:s");
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

	it("does not bill a turn to the server key when the user token expired", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "while signed out");
		userToken.value = "true";
		identity.tokenExpired = true;

		expect(await startQueuedTurn(conversationId)).toBe("failed");
		expect(generate).not.toHaveBeenCalled();
		const [row] = await collections.queuedInputs.find({ conversationId }).toArray();
		expect(row.status).toBe("failed");
		expect(row.error).toMatch(/sign in again/i);
	});

	it("leaves the queue to a turn waiting on a question", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await queue(conversationId, "after the answer");
		await awaitingInput(conversationId);

		expect(await startQueuedTurn(conversationId)).toBe("busy");
		expect(generate).not.toHaveBeenCalled();
	});

	it("refuses a normal send while a queued start holds the conversation", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		const release = await claimTurnStart(conversationId, undefined, "alive");
		expect(release).toBeDefined();

		expect(await claimTurnStart(conversationId, undefined, "working")).toBeUndefined();
		await release?.();
		const again = await claimTurnStart(conversationId, undefined, "working");
		expect(again).toBeDefined();
		await again?.();
	});

	it("lets a normal send through during a question but not during a running turn", async () => {
		const conversationId = conversation();
		await seedConversation(conversationId);
		await awaitingInput(conversationId);
		const latest = { id: "a1", from: "assistant" as const };

		const duringQuestion = await claimTurnStart(conversationId, latest, "working");
		expect(duringQuestion).toBeDefined();
		await duringQuestion?.();

		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: "g",
			conversationId,
			messageId: "a1",
			status: "running",
			startedAt: new Date(),
			lastHeartbeatAt: new Date(),
		} as never);
		expect(await claimTurnStart(conversationId, latest, "working")).toBeUndefined();
	});

	it("rotates the orphan sweep so conversations stuck on a question cannot starve the rest", async () => {
		const old = new Date(Date.now() - 60_000);
		const ids = Array.from({ length: 25 }, () => conversation());
		for (const id of ids) {
			await seedConversation(id);
			await collections.queuedInputs.insertOne({
				_id: new ObjectId(),
				conversationId: id,
				text: "orphan",
				status: "queued",
				source: "web",
				createdAt: old,
				updatedAt: old,
			});
			await awaitingInput(id);
		}
		const unchecked = () =>
			collections.queuedInputs.countDocuments({
				conversationId: { $in: ids },
				checkedAt: { $exists: false },
			});

		await sweepQueuedInputs(new Date());
		expect(await unchecked()).toBe(5);
		await sweepQueuedInputs(new Date(Date.now() + 1_000));
		expect(await unchecked()).toBe(0);
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
