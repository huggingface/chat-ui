import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { McpElicitation } from "$lib/types/McpElicitation";
import type { Message } from "$lib/types/Message";
import {
	canRetry,
	isRunSettled,
	lockChoices,
	readRunStatus,
	readTurn,
	releaseChoices,
	reserveSideQuestionQuota,
	shareAnswer,
	sharedAnswers,
	stageChoice,
	supersedeQuestion,
	supersededQuestions,
	findQuestion,
} from ".";

vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));

beforeAll(async () => {
	await ready;
});

const ids: ObjectId[] = [];

afterEach(async () => {
	const filter = { conversationId: { $in: ids } };
	await Promise.all([
		collections.conversations.deleteMany({ _id: { $in: ids } }),
		collections.turnStates.deleteMany(filter),
		collections.mcpElicitations.deleteMany(filter),
		collections.parkedCalls.deleteMany(filter),
		collections.queuedInputs.deleteMany(filter),
	]);
	ids.length = 0;
});

const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 12, minute));

function message(id: string, from: Message["from"], extra: Partial<Message> = {}): Message {
	return {
		id,
		from,
		content: "",
		children: [],
		ancestors: [],
		createdAt: at(0),
		updatedAt: at(0),
		...extra,
	} as Message;
}

async function seed(messages: Message[], extra: Record<string, unknown> = {}): Promise<ObjectId> {
	const _id = new ObjectId();
	ids.push(_id);
	await collections.conversations.insertOne({
		_id,
		model: "m",
		title: "t",
		messages,
		createdAt: at(0),
		updatedAt: at(0),
		...extra,
	} as never);
	return _id;
}

async function turnState(conversationId: ObjectId, messageId: string, status = "done") {
	await collections.turnStates.insertOne({
		_id: new ObjectId(),
		conversationId,
		messageId,
		producerId: "p",
		status,
		createdAt: at(1),
		updatedAt: at(2),
	} as never);
}

async function question(
	conversationId: ObjectId,
	fields: Partial<McpElicitation> & { elicitationId: string }
) {
	await collections.mcpElicitations.insertOne({
		_id: new ObjectId(),
		conversationId,
		status: "pending",
		request: { elicitationId: fields.elicitationId, server: "s", mode: "form", message: "Pick" },
		pending: { kind: "ask", messageId: "a1" },
		createdAt: at(1),
		updatedAt: at(1),
		...fields,
	} as never);
}

const park = (conversationId: ObjectId, messageId: string) =>
	collections.parkedCalls.insertOne({
		_id: new ObjectId(),
		conversationId,
		messageId,
		status: "waiting",
		createdAt: at(1),
		updatedAt: at(1),
	} as never);

describe("readTurn", () => {
	it("returns nothing until the assistant has a turn state", async () => {
		const id = await seed([message("u1", "user")]);
		expect(await readTurn(id)).toBeUndefined();
		const started = await seed([message("a1", "assistant")]);
		expect(await readTurn(started)).toBeUndefined();
	});

	it("reports a turn superseded by a new request before anything else", async () => {
		const id = await seed([message("a1", "assistant")]);
		await turnState(id, "a1");
		await question(id, { elicitationId: "q1", status: "resolved", slackSkippedByInputId: "i1" });
		expect(await readTurn(id)).toMatchObject({ kind: "superseded", message: { id: "a1" } });
	});

	it("maps the pending question, its staged choices and the newest shared answer", async () => {
		const id = await seed([message("a1", "assistant", { generationId: "g1" })]);
		await turnState(id, "a1", "awaiting_input");
		await question(id, { elicitationId: "q1", slackChoices: { 0: 2 }, slackChoiceRevision: 3 });
		await question(id, {
			elicitationId: "q0",
			status: "resolved",
			action: "accept",
			slackShareAnswer: true,
			content: { a: "x" },
		});
		const turn = await readTurn(id);
		if (turn?.kind !== "turn") throw new Error("expected a turn");
		expect(turn.question).toMatchObject({
			elicitationId: "q1",
			kind: "ask",
			messageId: "a1",
			choices: { 0: 2 },
			choiceRevision: 3,
		});
		expect(turn.sharedAnswer).toMatchObject({ elicitationId: "q0", content: { a: "x" } });
		expect(turn.live.alive).toBe(true);
		expect(turn.state.status).toBe("awaiting_input");
	});

	it("dates a continued turn from the turn it continues", async () => {
		const id = await seed([
			message("a0", "assistant", { createdAt: at(5) }),
			message("a1", "assistant", { createdAt: at(9), queuedContinuationOf: "a0" }),
		]);
		await turnState(id, "a1");
		const turn = await readTurn(id);
		expect(turn?.kind === "turn" && turn.startedAt).toEqual(at(5));
	});
});

describe("readRunStatus", () => {
	const plan = (updatedAt: Date) => ({ goal: "g", steps: [], version: 1, updatedAt });

	it("keeps the card on the steered turn and drops a plan older than it", async () => {
		const stale = await seed(
			[
				message("a0", "assistant", { createdAt: at(5) }),
				message("a1", "assistant", { queuedContinuationOf: "a0" }),
			],
			{ plan: plan(at(4)) }
		);
		expect(await readRunStatus(stale)).toMatchObject({
			messageId: "a1",
			cardMessageId: "a0",
			plan: null,
		});
		const fresh = await seed([message("a0", "assistant", { createdAt: at(5) })], {
			plan: plan(at(6)),
		});
		expect((await readRunStatus(fresh))?.plan?.updatedAt).toEqual(at(6));
	});
});

describe("question choices", () => {
	it("stages, locks once per revision, and releases", async () => {
		const id = await seed([message("a1", "assistant")]);
		await question(id, { elicitationId: "q1" });
		await stageChoice(id, "q1", 0, 1);
		await stageChoice(id, "q1", 1, 0);
		expect(await findQuestion(id, "q1")).toMatchObject({
			choices: { 0: 1, 1: 0 },
			choiceRevision: 2,
		});
		expect(await lockChoices(id, "q1", 1)).toBe(false);
		expect(await lockChoices(id, "q1", 2)).toBe(true);
		expect(await lockChoices(id, "q1", 2)).toBe(false);
		await stageChoice(id, "q1", 0, 3);
		expect((await findQuestion(id, "q1"))?.choices).toEqual({ 0: 1, 1: 0 });
		await releaseChoices(id, "q1");
		expect(await lockChoices(id, "q1", 2)).toBe(true);
	});

	it("only lists answers a client shared once the user accepted them", async () => {
		const id = await seed([message("a1", "assistant")]);
		await question(id, { elicitationId: "q1" });
		await shareAnswer(id, "q1");
		expect(await sharedAnswers(id)).toEqual([]);
		await collections.mcpElicitations.updateOne(
			{ conversationId: id, elicitationId: "q1" },
			{ $set: { status: "resolved", action: "accept", resolution: "user" } }
		);
		expect((await sharedAnswers(id)).map((q) => q.elicitationId)).toEqual(["q1"]);
	});
});

describe("supersedeQuestion", () => {
	const supersede = (conversationId: ObjectId, inputId = "i1") =>
		supersedeQuestion({ conversationId, messageId: "a1", inputId, reason: "new request" });

	it("resolves a pending ask once, and repeats the outcome for the same input", async () => {
		const id = await seed([message("a1", "assistant")]);
		await question(id, { elicitationId: "q1" });
		expect(await supersede(id)).toBe("superseded");
		expect(await supersede(id)).toBe("superseded");
		expect(await supersede(id, "i2")).toBe("none");
		expect(await supersededQuestions(id)).toHaveLength(1);
		expect(await findQuestion(id, "q1")).toMatchObject({ kind: "ask" });
	});

	it("never supersedes answers being submitted, and lets reviews through", async () => {
		const submitting = await seed([message("a1", "assistant")]);
		await question(submitting, { elicitationId: "q1", slackSubmitting: true });
		expect(await supersede(submitting)).toBe("none");

		const review = await seed([message("a1", "assistant")]);
		await question(review, {
			elicitationId: "r1",
			pending: { kind: "review", messageId: "a1" } as never,
		});
		expect(await supersede(review)).toBe("review");
	});
});

describe("run liveness", () => {
	it("is settled only with nothing parked or queued", async () => {
		const id = await seed([message("a1", "assistant")]);
		expect(await isRunSettled(id)).toBe(true);
		await collections.queuedInputs.insertOne({
			_id: new ObjectId(),
			conversationId: id,
			text: "more",
			status: "queued",
			source: "slack",
			createdAt: at(1),
			updatedAt: at(1),
		});
		expect(await isRunSettled(id)).toBe(false);
		await collections.queuedInputs.deleteMany({ conversationId: id });
		await park(id, "a1");
		expect(await isRunSettled(id)).toBe(false);
	});

	it("retries only the newest dead turn that failed or was interrupted", async () => {
		const id = await seed([message("a1", "assistant", { generationId: "g1" })]);
		await turnState(id, "a1", "done");
		expect(await canRetry(id, "a1", "g1")).toBe(false);
		await collections.turnStates.updateOne({ conversationId: id }, { $set: { status: "failed" } });
		expect(await canRetry(id, "a1", "g0")).toBe(false);
		expect(await canRetry(id, "a1", "g1")).toBe(true);
		await park(id, "a1");
		expect(await canRetry(id, "a1", "g1")).toBe(false);
	});
});

describe("reserveSideQuestionQuota", () => {
	it("takes slots up to each key's limit and gives back a refused reservation", async () => {
		const key = `test-btw:${new ObjectId()}`;
		const quota = [{ key, perMinute: 2 }];
		expect(await reserveSideQuestionQuota(quota)).toBe(true);
		expect(await reserveSideQuestionQuota(quota)).toBe(true);
		expect(await reserveSideQuestionQuota(quota)).toBe(false);
		expect(await collections.messageEvents.countDocuments({ userId: key })).toBe(2);
		await collections.messageEvents.deleteMany({ userId: key });
	});
});
