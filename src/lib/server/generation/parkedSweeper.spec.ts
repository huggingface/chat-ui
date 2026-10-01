import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	isDocumentTooLarge,
	renewClaim,
	resumeParkedCall,
	sweepParkedCalls,
	wakeParkedCallEarly,
} from "./parkedSweeper";
import { turnWaiting } from "./turnState";
import { submitElicitationAnswer } from "$lib/server/mcp/elicitation";
import type { ParkedCall } from "$lib/types/ParkedCall";
import type { McpElicitation } from "$lib/types/McpElicitation";
import type { Message } from "$lib/types/Message";
import type { TextGenerationContext } from "$lib/server/textGeneration/types";
import { ToolResultStatus } from "$lib/types/Tool";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateStatus,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

/**
 * The model is stubbed: what is under test is what the sweeper does around a
 * run (delivery, settling the row, the save), not what a run produces.
 */
const generation = vi.hoisted(() => ({
	runs: [] as TextGenerationContext[],
	run: undefined as undefined | ((ctx: TextGenerationContext) => AsyncGenerator<MessageUpdate>),
}));
vi.mock(import("$lib/server/textGeneration"), async (importOriginal) => ({
	...(await importOriginal()),
	textGeneration: (ctx: TextGenerationContext) => {
		generation.runs.push(ctx);
		return (generation.run ?? answers("Checked: the job finished."))(ctx);
	},
}));

function answers(text: string) {
	return async function* (): AsyncGenerator<MessageUpdate> {
		yield { type: MessageUpdateType.Stream, token: text };
		yield { type: MessageUpdateType.FinalAnswer, text, interrupted: false };
	};
}

const park = (over: Partial<ParkedCall> = {}): ParkedCall => ({
	_id: new ObjectId(),
	parkedCallId: new ObjectId().toString(),
	conversationId: new ObjectId(),
	messageId: "msg-1",
	toolCallId: "call-1",
	toolUuid: "uuid-1",
	kind: "timer",
	status: "waiting",
	// Due unless a test says otherwise.
	resumeAt: new Date(Date.now() - 1_000),
	reason: "training job to reach step 1000",
	attempts: 0,
	createdAt: new Date(Date.now() - 60_000),
	updatedAt: new Date(Date.now() - 60_000),
	...over,
});

const RESUMED_TITLE = "resumed turn";

const waitCall = (row: ParkedCall): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Call,
	uuid: row.toolUuid,
	call: { name: "wait", parameters: { seconds: 60, reason: row.reason } },
});

const waitResult = (row: ParkedCall): MessageUpdate => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid: row.toolUuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name: "wait", parameters: {} },
		outputs: [{ text: `Waited 60s for: ${row.reason}. You are now resumed.` }],
		display: true,
	},
});

/**
 * A conversation parked on `row`'s wait, as the wait tool leaves it: the call
 * stored with no result, and the turn state `waiting`. `padBytes` pads the
 * user message so the document sits that close under MongoDB's 16 MiB limit.
 */
async function seedParkedTurn(
	row: ParkedCall,
	{ updates = [waitCall(row)], padBytes = 0 }: { updates?: MessageUpdate[]; padBytes?: number } = {}
) {
	await collections.conversations.insertOne({
		_id: row.conversationId,
		sessionId: "s",
		model: "test-org/test-model",
		title: RESUMED_TITLE,
		rootMessageId: "u1",
		messages: [
			{
				id: "u1",
				from: "user",
				content: padBytes > 0 ? "x".repeat(padBytes) : "train it",
				ancestors: [],
				children: [row.messageId],
			},
			{
				id: row.messageId,
				from: "assistant",
				content: "",
				updates,
				ancestors: ["u1"],
				children: [],
			},
		],
		createdAt: new Date(),
		updatedAt: new Date(),
	} as never);
	await collections.turnStates.insertOne({
		_id: new ObjectId(),
		conversationId: row.conversationId,
		messageId: row.messageId,
		producerId: "gen-old",
		status: "waiting",
		createdAt: new Date(),
		updatedAt: new Date(),
	} as never);
	await collections.parkedCalls.insertOne(row);
}

async function storedAssistant(row: ParkedCall): Promise<Message | undefined> {
	const conv = await collections.conversations.findOne({ _id: row.conversationId });
	return conv?.messages.find((m) => m.id === row.messageId);
}

const resultsFor = (message: Pick<Message, "updates"> | undefined, uuid: string) =>
	(message?.updates ?? []).filter(
		(u) =>
			u.type === MessageUpdateType.Tool &&
			(u.subtype === MessageToolUpdateType.Result || u.subtype === MessageToolUpdateType.Error) &&
			u.uuid === uuid
	);

async function storedWaitResult(row: ParkedCall): Promise<string> {
	const [result] = resultsFor(await storedAssistant(row), row.toolUuid);
	return result?.type === MessageUpdateType.Tool &&
		result.subtype === MessageToolUpdateType.Result &&
		result.result.status === ToolResultStatus.Success
		? String(result.result.outputs[0]?.text)
		: "";
}

/** Hands the lease back as if the claiming pod died, so the next sweep may take the row. */
async function expireLease(row: ParkedCall) {
	await collections.parkedCalls.updateOne(
		{ _id: row._id },
		{ $set: { takenAt: new Date(Date.now() - 10 * 60_000) } }
	);
}

/** Fails conversation writes whose `$set` touches `field`; every other write goes through. */
function failConversationWrite(field: string, err: Error) {
	const updateOne = collections.conversations.updateOne.bind(collections.conversations);
	return vi
		.spyOn(collections.conversations, "updateOne")
		.mockImplementation(((filter: never, update: { $set?: Record<string, unknown> }) =>
			update.$set && field in update.$set
				? Promise.reject(err)
				: updateOne(filter, update as never)) as never);
}

/** Headroom that fits the seeded turn but not a run's output on top of it. */
const NEAR_LIMIT_PAD = 16 * 1024 * 1024 - 64 * 1024;
const BIG_ANSWER = "y".repeat(256 * 1024);

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	generation.runs = [];
	generation.run = undefined;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await collections.parkedCalls.deleteMany({});
	await collections.turnStates.deleteMany({});
	await collections.generations.deleteMany({});
	await collections.generationEvents.deleteMany({});
	await collections.mcpElicitations.deleteMany({});
	await collections.conversations.deleteMany({ title: { $in: ["abandoned turn", RESUMED_TITLE] } });
});

describe("sweepParkedCalls", () => {
	it("leaves a row alone until its timer is due", async () => {
		await collections.parkedCalls.insertOne(park({ resumeAt: new Date(Date.now() + 60_000) }));

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("waiting");
		expect(row?.attempts).toBe(0);
	});

	it("abandons a due row whose conversation is gone, instead of retrying forever", async () => {
		// The conversation id points at nothing, which is the shape of a deleted chat.
		await collections.parkedCalls.insertOne(park());

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("abandoned");
		expect(row?.abandonedReason).toBe("conversation is gone");
	});

	it("claims each due row exactly once", async () => {
		// The claim is what stops two pods waking the same turn: the status is in the
		// filter, so a racing sweep finds the row already out of `waiting`.
		await collections.parkedCalls.insertMany([park(), park(), park()]);

		await Promise.all([sweepParkedCalls(), sweepParkedCalls()]);

		const rows = await collections.parkedCalls.find({}).toArray();
		expect(rows).toHaveLength(3);
		expect(rows.every((r) => r.status === "abandoned")).toBe(true);
		// One claim each. A second claim would have incremented past 1.
		expect(rows.map((r) => r.attempts)).toEqual([1, 1, 1]);
	});

	it("reclaims a claim whose lease expired", async () => {
		// A resume that dies before its own error handling — or a pod that dies at
		// any point — leaves the row in `resuming`. Without a lease it sits there
		// until the TTL removes it, and the attempt ceiling never applies.
		await collections.parkedCalls.insertOne(
			park({ status: "resuming", takenAt: new Date(Date.now() - 10 * 60_000), attempts: 1 })
		);

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.attempts).toBe(2);
		expect(row?.status).toBe("abandoned");
	});

	it("leaves a claim alone while its lease holds", async () => {
		// Otherwise two sweepers a few seconds apart both resume the same turn.
		await collections.parkedCalls.insertOne(
			park({ status: "resuming", takenAt: new Date(), attempts: 1 })
		);

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("resuming");
		expect(row?.attempts).toBe(1);
	});

	it("gives up on a row that keeps failing to resume", async () => {
		await collections.parkedCalls.insertOne(park({ attempts: 3 }));

		await sweepParkedCalls();

		const row = await collections.parkedCalls.findOne({});
		expect(row?.status).toBe("abandoned");
		expect(row?.abandonedReason).toContain("gave up");
	});

	it("abandonment closes the turn: state fails, and the message reads terminal", async () => {
		// An abandoned park used to leave the state doc `waiting`: the turn read
		// alive forever, subscriptions churned on heartbeats, and the client sat
		// on an "overdue" banner for a wake that could not come.
		const row = park({ attempts: 3 });
		await collections.conversations.insertOne({
			_id: row.conversationId,
			sessionId: "s",
			model: "test-org/test-model",
			title: "abandoned turn",
			rootMessageId: "u1",
			messages: [
				{ id: "u1", from: "user", content: "go", ancestors: [], children: [row.messageId] },
				{
					id: row.messageId,
					from: "assistant",
					content: "",
					updates: [],
					ancestors: ["u1"],
					children: [],
				},
			],
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId: row.conversationId,
			messageId: row.messageId,
			producerId: "gen-old",
			status: "waiting",
			createdAt: new Date(),
			updatedAt: new Date(),
		} as never);
		await collections.parkedCalls.insertOne(row);

		await sweepParkedCalls();

		expect((await collections.parkedCalls.findOne({}))?.status).toBe("abandoned");
		const state = await collections.turnStates.findOne({ conversationId: row.conversationId });
		expect(state?.status).toBe("failed");
		expect(state?.error).toContain("abandoned");
		// Persisted into the message, with no producer to emit it: the next
		// snapshot reads terminal — the banner clears and Resume is on offer.
		const conv = await collections.conversations.findOne({ _id: row.conversationId });
		const message = conv?.messages.find((m) => m.id === row.messageId);
		expect(message?.updates?.at(-1)).toMatchObject({ type: "turnState", state: "failed" });
	});
});

describe("resuming a parked wait", () => {
	it("delivers the wait result once, runs the turn, and settles the row", async () => {
		const row = park();
		await seedParkedTurn(row);

		await sweepParkedCalls();

		expect(generation.runs).toHaveLength(1);
		expect((await collections.parkedCalls.findOne({ _id: row._id }))?.status).toBe("resumed");
		const message = await storedAssistant(row);
		expect(resultsFor(message, row.toolUuid)).toHaveLength(1);
		expect(message?.content).toBe("Checked: the job finished.");
		const state = await collections.turnStates.findOne({ conversationId: row.conversationId });
		expect(state?.status).toBe("done");
	});

	it("a wait woken by a job's end tells the model what ended, in the harness's words", async () => {
		const row = park({
			plannedResumeAt: new Date(Date.now() + 20 * 60_000),
			wokeByHarnessAt: new Date(),
			serviceEvents: [
				{
					serviceId: new ObjectId(),
					kind: "job",
					jobId: "0123456789abcdef01234567",
					name: "sft-smoke",
					flavor: "a10g-small",
					from: "RUNNING",
					to: "ERROR",
					ranSeconds: 137,
					at: new Date(),
				},
			],
		});
		await seedParkedTurn(row);

		await sweepParkedCalls();

		const text = await storedWaitResult(row);
		expect(text).toContain("because a job you started changed state");
		expect(text).toContain("Job sft-smoke (a10g-small, id 0123456789abcdef01234567) failed: ERROR");
		expect(text).not.toContain("The user asked you to check early");
	});

	it("a wait the user woke keeps the user's wording", async () => {
		const row = park({
			plannedResumeAt: new Date(Date.now() + 20 * 60_000),
			wokeEarlyAt: new Date(),
		});
		await seedParkedTurn(row);

		await sweepParkedCalls();

		const text = await storedWaitResult(row);
		expect(text).toContain("The user asked you to check early");
		expect(text).not.toContain("changed state");
	});

	it("a re-claimed resume continues the stored turn without a second result", async () => {
		// The pod that first resumed this wait died after its result was stored:
		// the row sits in `resuming` until the lease runs out, then a sweep
		// takes it again. That second attempt used to deliver the result again.
		const row = park({ status: "resuming", attempts: 1 });
		await seedParkedTurn(row, { updates: [waitCall(row), waitResult(row)] });
		await expireLease(row);

		await sweepParkedCalls();

		expect(generation.runs).toHaveLength(1);
		// What the model continues from: its call, answered exactly once.
		const history = generation.runs[0].messages.find((m) => m.id === row.messageId);
		expect(resultsFor(history, row.toolUuid)).toHaveLength(1);
		expect(resultsFor(await storedAssistant(row), row.toolUuid)).toHaveLength(1);
		expect((await collections.parkedCalls.findOne({ _id: row._id }))?.status).toBe("resumed");
	});

	it("resuming the same park twice still leaves one result", async () => {
		const row = park({ status: "resuming", attempts: 1, takenAt: new Date() });
		await seedParkedTurn(row);

		await resumeParkedCall(row);
		await resumeParkedCall(row);

		expect(generation.runs).toHaveLength(2);
		expect(resultsFor(await storedAssistant(row), row.toolUuid)).toHaveLength(1);
	});

	it("a save that throws still settles the row, so no sweep runs the turn again", async () => {
		const row = park();
		await seedParkedTurn(row);
		failConversationWrite("messages", new Error("connection reset by peer"));

		await sweepParkedCalls();
		vi.restoreAllMocks();
		await expireLease(row);
		await sweepParkedCalls();

		expect(generation.runs).toHaveLength(1);
		const after = await collections.parkedCalls.findOne({ _id: row._id });
		expect(after?.status).toBe("resumed");
		expect(after?.attempts).toBe(1);
		// The writer still closed the run instead of leaving it to the reaper.
		const run = await collections.generations.findOne({
			generationId: generation.runs[0].generationId,
		});
		expect(run?.status).toBe("completed");
	});

	it("a failure before the run starts is still retried, up to the attempt ceiling", async () => {
		// Only a save that cannot succeed skips the retry. A transient failure
		// before anything ran keeps the lease-and-attempts recovery.
		const row = park();
		await seedParkedTurn(row);
		failConversationWrite("messages.$.generationId", new Error("connection reset by peer"));

		await sweepParkedCalls();
		expect(await collections.parkedCalls.findOne({ _id: row._id })).toMatchObject({
			status: "resuming",
			attempts: 1,
		});
		for (let i = 0; i < 3; i += 1) {
			await expireLease(row);
			await sweepParkedCalls();
		}

		expect(generation.runs).toHaveLength(0);
		const after = await collections.parkedCalls.findOne({ _id: row._id });
		expect(after?.status).toBe("abandoned");
		expect(after?.abandonedReason).toBe("gave up after 4 attempts");
	});

	it("a conversation too large to save abandons the park and fails the turn, once", async () => {
		const row = park();
		await seedParkedTurn(row, { padBytes: NEAR_LIMIT_PAD });
		generation.run = answers(BIG_ANSWER);

		await sweepParkedCalls();
		await expireLease(row);
		await sweepParkedCalls();

		expect(generation.runs).toHaveLength(1);
		const after = await collections.parkedCalls.findOne({ _id: row._id });
		expect(after?.status).toBe("abandoned");
		expect(after?.abandonedReason).toContain("too large to save");
		const state = await collections.turnStates.findOne({ conversationId: row.conversationId });
		expect(state?.status).toBe("failed");
		expect(state?.error).toContain("too large to save");
		// The conversation cannot take the failure, so the user reads it from the
		// turn's event log: live, or replayed on reattach.
		const events = await collections.generationEvents
			.find({ generationId: generation.runs[0].generationId })
			.sort({ seq: 1 })
			.toArray();
		expect(events.at(-1)?.event).toMatchObject({ type: "turnState", state: "failed" });
		expect(events.map((e) => e.event)).toContainEqual(
			expect.objectContaining({ type: "status", status: MessageUpdateStatus.Error })
		);
	});

	it("a too-large save also abandons the wait the resumed run parked on", async () => {
		// Left waiting, the new park resumes into the same unwritable document
		// and spends a whole run before failing again.
		const row = park();
		await seedParkedTurn(row, { padBytes: NEAR_LIMIT_PAD });
		const nextPark = park({
			conversationId: row.conversationId,
			resumeAt: new Date(Date.now() + 60_000),
		});
		generation.run = async function* (ctx) {
			yield { type: MessageUpdateType.Stream, token: BIG_ANSWER };
			await collections.parkedCalls.insertOne({ ...nextPark, generationId: ctx.generationId });
			yield await turnWaiting(
				{
					conversationId: row.conversationId,
					messageId: row.messageId,
					producerId: ctx.generationId ?? "",
				},
				{ until: nextPark.resumeAt, reason: nextPark.reason }
			);
		};

		await sweepParkedCalls();

		expect((await collections.parkedCalls.findOne({ _id: nextPark._id }))?.status).toBe(
			"abandoned"
		);
		const state = await collections.turnStates.findOne({ conversationId: row.conversationId });
		expect(state?.status).toBe("failed");
		expect(state?.waitUntil).toBeUndefined();
	});

	it("a too-large save closes the question the resumed run asked, so no answer can resume it", async () => {
		// The question lives in mcpElicitations, not parkedCalls. Left open, an
		// answer starts a fresh run into the same unwritable document.
		const row = park();
		await seedParkedTurn(row, { padBytes: NEAR_LIMIT_PAD });
		const question = (elicitationId: string, generationId: string): McpElicitation => ({
			_id: new ObjectId(),
			elicitationId,
			conversationId: row.conversationId,
			generationId,
			status: "pending",
			request: { elicitationId, server: "assistant", mode: "form", message: "Which?", fields: [] },
			pending: { kind: "ask", messageId: row.messageId, toolCallId: "call-2", toolUuid: "uuid-2" },
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		// Another run's question on the same message: not this run's to close.
		await collections.mcpElicitations.insertOne(question("q-other", "gen-other"));
		generation.run = async function* (ctx) {
			yield { type: MessageUpdateType.Stream, token: BIG_ANSWER };
			await collections.mcpElicitations.insertOne(question("q-mine", ctx.generationId ?? ""));
		};

		await sweepParkedCalls();

		const answer = (elicitationId: string) =>
			submitElicitationAnswer({
				elicitationId,
				conversationId: row.conversationId,
				action: "accept",
				content: {},
			});
		expect(await answer("q-mine")).toMatchObject({ ok: false, status: 409 });
		expect(await answer("q-other")).toMatchObject({ ok: true });
		// The open form closes for anyone watching or reattaching.
		const events = await collections.generationEvents
			.find({ generationId: generation.runs[0].generationId })
			.toArray();
		expect(events.map((e) => e.event)).toContainEqual(
			expect.objectContaining({
				type: MessageUpdateType.Elicitation,
				subtype: MessageElicitationUpdateType.Resolved,
				elicitationId: "q-mine",
				resolution: "expired",
			})
		);
	});
});

describe("isDocumentTooLarge", () => {
	// Real errors from the test mongod and the driver, not hand-built shapes:
	// a mismatch here is exactly how a size failure would slip back into retries.
	const id = new ObjectId();
	afterEach(async () => {
		await collections.conversations.deleteMany({ _id: id });
	});

	const failureOf = async (write: () => Promise<unknown>) => {
		try {
			await write();
		} catch (err) {
			return err;
		}
		throw new Error("expected the write to fail");
	};

	it("recognises every way a write past the document limit fails", async () => {
		await collections.conversations.insertOne({
			_id: id,
			title: "x".repeat(NEAR_LIMIT_PAD),
		} as never);

		const oversizedCommand = await failureOf(() =>
			collections.conversations.updateOne(
				{ _id: id },
				{ $set: { title: "x".repeat(16 * 1024 * 1024 + 256 * 1024) } }
			)
		);
		const outgrowsLimit = await failureOf(() =>
			collections.conversations.updateOne({ _id: id }, {
				$push: { messages: { id: "m", content: BIG_ANSWER } },
			} as never)
		);
		const overSerializerBuffer = await failureOf(() =>
			collections.conversations.updateOne(
				{ _id: id },
				{ $set: { title: "x".repeat(18 * 1024 * 1024) } }
			)
		);
		const bulkInsert = await failureOf(() =>
			collections.conversations.insertMany([{ title: "x".repeat(17 * 1024 * 1024) } as never])
		);

		expect(isDocumentTooLarge(oversizedCommand)).toBe(true);
		expect(isDocumentTooLarge(outgrowsLimit)).toBe(true);
		expect(isDocumentTooLarge(overSerializerBuffer)).toBe(true);
		expect(isDocumentTooLarge(bulkInsert)).toBe(true);
	});

	it("leaves other failures to the ordinary retry", async () => {
		await collections.conversations.insertOne({ _id: id, title: "t" } as never);
		const duplicateKey = await failureOf(() =>
			collections.conversations.insertOne({ _id: id, title: "t" } as never)
		);

		expect(isDocumentTooLarge(duplicateKey)).toBe(false);
		expect(isDocumentTooLarge(new Error("connection reset by peer"))).toBe(false);
		expect(isDocumentTooLarge(new RangeError("Invalid array length"))).toBe(false);
	});
});

describe("renewClaim", () => {
	it("keeps a live resume's row from being stolen when its original lease ages out", async () => {
		// A resumed ML turn routinely runs longer than the claim lease. The live
		// resume renews; without the renewal the sweeper would re-claim the row
		// and launch a SECOND producer onto the same turn — dueling writers,
		// interleaved turn states (the stuck wait banner), an abandon mid-run.
		const row = park({
			status: "resuming",
			takenAt: new Date(Date.now() - 10 * 60_000),
			attempts: 1,
		});
		await collections.parkedCalls.insertOne(row);

		await renewClaim(row);
		await sweepParkedCalls();

		const after = await collections.parkedCalls.findOne({});
		expect(after?.status).toBe("resuming");
		expect(after?.attempts).toBe(1);
	});

	it("never revives a row whose resume already finished", async () => {
		const takenAt = new Date(Date.now() - 60_000);
		const row = park({ status: "resumed", takenAt, attempts: 1 });
		await collections.parkedCalls.insertOne(row);

		await renewClaim(row);

		const after = await collections.parkedCalls.findOne({});
		expect(after?.status).toBe("resumed");
		expect(after?.takenAt?.getTime()).toBe(takenAt.getTime());
	});
});

describe("wakeParkedCallEarly", () => {
	it("makes a waiting row due now and records that the user cut the wait short", async () => {
		const row = park({ resumeAt: new Date(Date.now() + 10 * 60_000) });
		await collections.parkedCalls.insertOne(row);

		const woken = await wakeParkedCallEarly(row.conversationId, row.messageId);

		expect(woken).toBe(true);
		const after = await collections.parkedCalls.findOne({});
		// Still `waiting`: the ordinary claim decides who resumes it, so an early
		// wake can never race a sweeper into two producers for one turn.
		expect(after?.status).toBe("waiting");
		expect(after?.resumeAt.getTime()).toBeLessThanOrEqual(Date.now());
		expect(after?.wokeEarlyAt).toBeInstanceOf(Date);
		// The deadline it asked for survives the overwrite, so the resumed round
		// can tell the model how much of its wait was skipped.
		expect(after?.plannedResumeAt?.getTime()).toBe(row.resumeAt.getTime());
	});

	it("keeps the deadline the model asked for when a job's end already moved it", async () => {
		const asked = new Date(Date.now() + 20 * 60_000);
		const row = park({
			resumeAt: new Date(Date.now() + 5_000),
			plannedResumeAt: asked,
			wokeByHarnessAt: new Date(),
		});
		await collections.parkedCalls.insertOne(row);

		await wakeParkedCallEarly(row.conversationId, row.messageId);

		const after = await collections.parkedCalls.findOne({});
		expect(after?.plannedResumeAt?.getTime()).toBe(asked.getTime());
	});

	it("only touches the turn it was asked about", async () => {
		const mine = park({ resumeAt: new Date(Date.now() + 10 * 60_000) });
		const other = park({ messageId: "msg-2", resumeAt: new Date(Date.now() + 10 * 60_000) });
		await collections.parkedCalls.insertMany([mine, other]);

		await wakeParkedCallEarly(mine.conversationId, mine.messageId);

		const untouched = await collections.parkedCalls.findOne({ messageId: "msg-2" });
		expect(untouched?.resumeAt.getTime()).toBe(other.resumeAt.getTime());
		expect(untouched?.wokeEarlyAt).toBeUndefined();
	});

	it("reports no wake when the turn is not parked on a timer", async () => {
		const row = park({ status: "resuming" });
		await collections.parkedCalls.insertOne(row);

		expect(await wakeParkedCallEarly(row.conversationId, row.messageId)).toBe(false);
	});
});
