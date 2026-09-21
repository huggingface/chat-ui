/**
 * An answered `ask_user_question`, end to end: the real conversation route parks the turn,
 * the real answer endpoint records the answer, and the server continues the turn with no
 * second request from a browser. Only the OpenAI-compatible upstream and the MCP edges are
 * scripted (same placement as replayRoundTrip.spec.ts), so what is asserted is what a
 * provider would actually be sent after the answer.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import {
	MessageElicitationUpdateType,
	MessageToolUpdateType,
	MessageUpdateType,
} from "$lib/types/MessageUpdate";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import {
	streamFor,
	type ChatMessage,
	type Round,
} from "$lib/server/textGeneration/__tests__/replayHarness";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("openai", async (importOriginal) => ({
	...(await importOriginal<typeof import("openai")>()),
	OpenAI: class {
		chat = { completions: { create: mocks.create } };
	},
}));
vi.mock("$lib/utils/mlAssistantFlag", () => ({ ML_ASSISTANT_MODE: true }));
vi.mock("$lib/server/mcp/registry", () => ({
	getMcpServers: () => [],
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
const { submitElicitationAnswer, claimElicitationResume, RESUME_LEASE_MS } =
	await import("$lib/server/mcp/elicitation");
const { sweepAnsweredAsks, resumeAnsweredAsk } = await import("../askResume");

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

function scriptRounds(rounds: Round[]) {
	let next = 0;
	mocks.create.mockImplementation(async () => {
		const round = rounds[next++];
		if (!round) throw new Error(`upstream called ${next}x but only ${rounds.length} scripted`);
		return streamFor(round);
	});
}

function outgoing(n: number): ChatMessage[] {
	const call = mocks.create.mock.calls[n];
	if (!call) throw new Error(`no upstream request #${n} (saw ${mocks.create.mock.calls.length})`);
	return call[0].messages as ChatMessage[];
}

const toolResultsIn = (messages: ChatMessage[]): string[] =>
	messages.filter((m) => m.role === "tool").map((m) => String(m.content));

async function newConversation() {
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
	});
	return { conv, locals };
}

async function reload(conv: Conversation): Promise<Conversation> {
	const fresh = await collections.conversations.findOne({ _id: conv._id });
	if (!fresh) throw new Error("conversation vanished");
	return fresh;
}

const lastAssistant = (conv: Conversation): Message => {
	const message = conv.messages.findLast((m) => m.from === "assistant");
	if (!message) throw new Error("no assistant message");
	return message;
};

async function post(conv: Conversation, locals: App.Locals, data: Record<string, unknown>) {
	const form = new FormData();
	form.set("data", JSON.stringify(data));
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
	// Draining the body is what lets the route's final save run. Read chunk by chunk: the
	// route enqueues strings, which `text()` refuses.
	const reader = response.body?.getReader();
	if (!reader) throw new Error("no response body");
	let body = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return body;
		body += typeof value === "string" ? value : new TextDecoder().decode(value);
	}
}

const sendMessage = async (conv: Conversation, locals: App.Locals, prompt: string) =>
	post(conv, locals, { inputs: prompt, id: (await reload(conv)).messages.at(-1)?.id });

/** Run a turn that parks on a question; returns the open prompt's id. */
async function parkOnQuestion(conv: Conversation, locals: App.Locals): Promise<string> {
	await sendMessage(conv, locals, "Build me a pipeline.");
	const row = await collections.mcpElicitations.findOne({ conversationId: conv._id });
	if (!row) throw new Error("the turn did not park on a question");
	expect(row.status).toBe("pending");
	return row.elicitationId;
}

async function answerOverHttp(
	conv: Conversation,
	locals: App.Locals,
	elicitationId: string,
	body: Record<string, unknown> = { action: "accept", content: { q1: "Postgres" } }
): Promise<Response> {
	try {
		return await ANSWER({
			request: new Request(`http://localhost/conversation/${conv._id}/elicitation`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ elicitationId, ...body }),
			}),
			locals,
			params: { id: conv._id.toString() },
		} as never);
	} catch (err) {
		// SvelteKit's `error()` throws; outside the framework nothing turns it into a response.
		const status = (err as { status?: unknown } | null)?.status;
		if (typeof status !== "number") throw err;
		return new Response(null, { status });
	}
}

/** Record an answer the way a process that then dies does: no continuation started. */
const answerAndDie = (conv: Conversation, elicitationId: string) =>
	submitElicitationAnswer({
		elicitationId,
		conversationId: conv._id,
		action: "accept",
		content: { q1: "Postgres" },
	});

const turnStatus = async (conv: Conversation, messageId: string) =>
	(await collections.turnStates.findOne({ conversationId: conv._id, messageId }))?.status;

/**
 * The turn reached `status` and no producer is still writing. The state flips before the
 * final save (in every producer), so the state alone would let a test read a stale message.
 */
const turnIs = (conv: Conversation, messageId: string, status: string) =>
	vi.waitFor(
		async () => {
			expect(await turnStatus(conv, messageId)).toBe(status);
			expect(
				await collections.generations.countDocuments({
					conversationId: conv._id,
					status: "running",
				})
			).toBe(0);
		},
		{ timeout: 10_000, interval: 25 }
	);

const settlements = (message: Message, elicitationId: string) =>
	(message.updates ?? []).filter(
		(u) =>
			u.type === MessageUpdateType.Elicitation &&
			u.subtype === MessageElicitationUpdateType.Resolved &&
			u.elicitationId === elicitationId
	);

const toolResults = (message: Message) =>
	(message.updates ?? []).filter(
		(u) => u.type === MessageUpdateType.Tool && u.subtype === MessageToolUpdateType.Result
	);

const backdate = (elicitationId: string, ms: number) =>
	collections.mcpElicitations.updateOne(
		{ elicitationId },
		{ $set: { resolvedAt: new Date(Date.now() - ms) } }
	);

beforeAll(async () => {
	await ready;
});

beforeEach(() => {
	mocks.create.mockReset();
});

afterEach(async () => {
	await cleanupTestData();
	await Promise.all([
		collections.mcpElicitations.deleteMany({}),
		collections.turnStates.deleteMany({}),
		collections.generations.deleteMany({}),
		collections.generationEvents.deleteMany({}),
	]);
});

describe("an answered question", () => {
	it("is continued by the server, with no second request from the browser", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		expect(await turnStatus(conv, parked.id)).toBe("awaiting_input");

		const response = await answerOverHttp(conv, locals, elicitationId);

		// `resume` is the instruction to the client to start the continuation.
		expect(await response.json()).toEqual({ ok: true, resume: false, messageId: parked.id });
		await turnIs(conv, parked.id, "done");

		expect(mocks.create).toHaveBeenCalledTimes(2);
		const [result] = toolResultsIn(outgoing(1));
		expect(result).toContain("Which database should the pipeline write to?");
		expect(result).toContain("Postgres");

		const message = lastAssistant(await reload(conv));
		expect(message.id).toBe(parked.id);
		expect(message.content).toContain("Postgres it is.");
		expect(settlements(message, elicitationId)).toHaveLength(1);
		expect(toolResults(message)).toHaveLength(1);
		// A fresh stamp is how a browser that was not watching finds the run.
		expect(message.generationId).not.toBe(parked.generationId);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed", attempts: 1 },
		});
	});

	it("has its answer stored before the model is called", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);

		let storedWhenCalled: Message | undefined;
		mocks.create.mockImplementation(async () => {
			storedWhenCalled = lastAssistant(await reload(conv));
			return streamFor({ content: "ok" });
		});
		await answerOverHttp(conv, locals, elicitationId);
		await turnIs(conv, lastAssistant(await reload(conv)).id, "done");

		if (!storedWhenCalled) throw new Error("the model was never called");
		expect(settlements(storedWhenCalled, elicitationId)).toHaveLength(1);
		expect(toolResults(storedWhenCalled)).toHaveLength(1);
	});

	it("runs once however many submits, tabs and old clients ask for it", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));

		// A double click, a second tab, and a client from before this change making the
		// second request it was built to make — all at once.
		const [first, second, oldClient] = await Promise.all([
			answerOverHttp(conv, locals, elicitationId),
			answerOverHttp(conv, locals, elicitationId),
			answerOverHttp(conv, locals, elicitationId).then(async (answered) => ({
				answered,
				body: await post(conv, locals, { resumeElicitationId: elicitationId, id: parked.id }),
			})),
		]);
		await turnIs(conv, parked.id, "done");

		// One answer lands; which of the three is the race.
		expect([first.status, second.status, oldClient.answered.status].sort()).toEqual([
			200, 409, 409,
		]);
		// Nothing streamed: the old client falls through to the turn's subscription.
		expect(oldClient.body).toBe("");
		expect(mocks.create).toHaveBeenCalledTimes(2);
		const message = lastAssistant(await reload(conv));
		expect(settlements(message, elicitationId)).toHaveLength(1);
		expect(toolResults(message)).toHaveLength(1);
		expect(message.content.match(/Postgres it is\./g)).toHaveLength(1);
	});

	it("does not let an old client's request disturb a run the server started", async () => {
		const { conv, locals } = await newConversation();
		let release: () => void = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		mocks.create.mockImplementation(async () => {
			await held;
			return streamFor({ content: "Postgres it is." });
		});

		await answerOverHttp(conv, locals, elicitationId);
		const running = lastAssistant(await reload(conv));
		const body = await post(conv, locals, { resumeElicitationId: elicitationId, id: parked.id });

		expect(body).toBe("");
		// The route stamps a generation and rewrites every message before it runs; a lost
		// claim has to stop it short of both.
		expect(lastAssistant(await reload(conv)).generationId).toBe(running.generationId);
		release();
		await turnIs(conv, parked.id, "done");
		expect(mocks.create).toHaveBeenCalledTimes(2);
	});

	it("follows the same path when the user declines", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "I will assume Postgres." }]);
		const elicitationId = await parkOnQuestion(conv, locals);

		await answerOverHttp(conv, locals, elicitationId, { action: "decline" });
		await turnIs(conv, lastAssistant(await reload(conv)).id, "done");

		expect(toolResultsIn(outgoing(1))[0]).toContain("The user declined to answer.");
	});

	it("starts the continuation a repeat answer finds missing", async () => {
		// Reloaded page, question shows open again, user answers a second time: the earlier
		// answer stands and this submit is what gets it continued — now by the server.
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);

		const repeat = await answerOverHttp(conv, locals, elicitationId, { action: "decline" });

		expect(repeat.status).toBe(409);
		expect(await repeat.json()).toMatchObject({
			answered: { action: "accept", resume: false, messageId: parked.id },
		});
		await turnIs(conv, parked.id, "done");
		expect(toolResultsIn(outgoing(1))[0]).toContain("Postgres");
	});
});

describe("the sweep for answers nothing continued", () => {
	it("continues an answer whose process died before it could", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 60_000);

		await Promise.all([sweepAnsweredAsks(), sweepAnsweredAsks()]);
		await turnIs(conv, parked.id, "done");

		expect(mocks.create).toHaveBeenCalledTimes(2);
		expect(toolResultsIn(outgoing(1))[0]).toContain("Postgres");
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed", attempts: 1 },
		});
	});

	it("leaves an answer the endpoint may still be continuing", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);
		await answerAndDie(conv, elicitationId);

		await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect((await collections.mcpElicitations.findOne({ elicitationId }))?.resume).toBeUndefined();
	});

	it("leaves old answers alone, so shipping it does not wake weeks of dropped turns", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 2 * 60 * 60_000);

		await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect((await collections.mcpElicitations.findOne({ elicitationId }))?.resume).toBeUndefined();
	});

	it("does not re-run a turn that was continued before claims existed", async () => {
		// Every answer the browser-driven resume did continue looks like this: the answer is
		// in the transcript and the row has never been claimed. The first sweep after this
		// ships sees an hour of them.
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerOverHttp(conv, locals, elicitationId);
		await turnIs(conv, parked.id, "done");
		await collections.mcpElicitations.updateOne({ elicitationId }, { $unset: { resume: "" } });
		await backdate(elicitationId, 60_000);

		await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(2);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed", attempts: 1 },
		});
		expect(await sweepAnsweredAsks().then(() => mocks.create.mock.calls.length)).toBe(2);
	});

	it("backs off a producer that holds the turn without a claim, and does not count it", async () => {
		// A pod from before this change, mid-deploy: it runs the old client's resume request
		// without claiming, and for its first seconds has stored nothing to go by.
		const { conv, locals } = await newConversation();
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 60_000);
		const now = new Date();
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId: crypto.randomUUID(),
			conversationId: conv._id,
			messageId: parked.id,
			status: "running",
			seq: 0,
			lastHeartbeatAt: now,
			startedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		for (let pass = 0; pass < 5; pass += 1) await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(1);
		// Never walked up to the ceiling: abandoning would fail a turn that is running fine.
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resuming", attempts: 0 },
		});
		expect(await turnStatus(conv, parked.id)).toBe("awaiting_input");
	});

	it("takes over a claim whose holder died before storing the answer", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 10 * 60_000);
		expect(await claimElicitationResume(conv._id, elicitationId)).not.toBeNull();

		// Held: a live claim is never stolen.
		await sweepAnsweredAsks();
		expect(mocks.create).toHaveBeenCalledTimes(1);

		await collections.mcpElicitations.updateOne(
			{ elicitationId },
			{ $set: { "resume.takenAt": new Date(Date.now() - RESUME_LEASE_MS - 1_000) } }
		);
		await sweepAnsweredAsks();
		await turnIs(conv, parked.id, "done");

		expect(mocks.create).toHaveBeenCalledTimes(2);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed", attempts: 2 },
		});
	});

	it("delivers the answer once when the first holder stored it and died before the model call", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 10 * 60_000);
		// What that holder left: the answer in the transcript, the claim held and lapsed.
		const row = await collections.mcpElicitations.findOne({ elicitationId });
		if (!row) throw new Error("row vanished");
		const { resumeParkedToolCall } = await import("$lib/server/mcp/resumeElicitation");
		const delivered = await resumeParkedToolCall({
			conversationId: conv._id,
			elicitationId,
			claimed: row,
		});
		await collections.conversations.updateOne({ _id: conv._id, "messages.id": parked.id }, {
			$push: { "messages.$.updates": { $each: delivered.updates } },
		} as never);
		await collections.mcpElicitations.updateOne(
			{ elicitationId },
			{
				$set: {
					resume: {
						status: "resuming",
						attempts: 1,
						takenAt: new Date(Date.now() - RESUME_LEASE_MS - 1_000),
					},
				},
			}
		);

		await sweepAnsweredAsks();
		await turnIs(conv, parked.id, "done");

		expect(mocks.create).toHaveBeenCalledTimes(2);
		const message = lastAssistant(await reload(conv));
		expect(settlements(message, elicitationId)).toHaveLength(1);
		expect(toolResults(message)).toHaveLength(1);
		expect(message.content).toContain("Postgres it is.");
	});

	it("never re-runs a turn whose claim was left open by a failed consuming write", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "Postgres it is." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerOverHttp(conv, locals, elicitationId);
		await turnIs(conv, parked.id, "done");
		await backdate(elicitationId, 10 * 60_000);
		await collections.mcpElicitations.updateOne(
			{ elicitationId },
			{
				$set: {
					"resume.status": "resuming",
					"resume.takenAt": new Date(Date.now() - RESUME_LEASE_MS - 1_000),
				},
			}
		);

		await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(2);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed" },
		});
	});

	it("gives up after repeated failures and closes the turn", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);
		await backdate(elicitationId, 10 * 60_000);
		await collections.mcpElicitations.updateOne(
			{ elicitationId },
			{
				$set: {
					resume: {
						status: "resuming",
						attempts: 3,
						takenAt: new Date(Date.now() - RESUME_LEASE_MS - 1_000),
					},
				},
			}
		);

		await sweepAnsweredAsks();

		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "abandoned", attempts: 4 },
		});
		// `awaiting_input` reads alive forever; nothing is coming for this turn.
		expect(await turnStatus(conv, parked.id)).toBe("failed");
	});
});

describe("a new message after an answer nothing continued", () => {
	it("gets the answer into history first, never an interrupted call", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "SQLite, then." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await answerAndDie(conv, elicitationId);

		await sendMessage(conv, locals, "Actually, never mind: use SQLite.");

		expect(mocks.create).toHaveBeenCalledTimes(2);
		const results = toolResultsIn(outgoing(1));
		expect(results).toHaveLength(1);
		expect(results[0]).toContain("The user answered");
		expect(results[0]).toContain("Postgres");
		expect(results[0]).not.toContain("interrupted before a result was recorded");

		const fresh = await reload(conv);
		const settled = fresh.messages.find((m) => m.id === parked.id);
		if (!settled) throw new Error("parked message vanished");
		expect(settlements(settled, elicitationId)).toHaveLength(1);
		expect(toolResults(settled)).toHaveLength(1);
		expect(lastAssistant(fresh).content).toContain("SQLite, then.");
		// Closed, so the old turn does not read alive behind the new one.
		expect(await turnStatus(conv, parked.id)).toBe("done");

		// And consumed: the sweep must not now run the old turn underneath the new one.
		await backdate(elicitationId, 60_000);
		await sweepAnsweredAsks();
		expect(mocks.create).toHaveBeenCalledTimes(2);
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			resume: { status: "resumed" },
		});
	});

	it("records a late answer without running the turn the user has moved on from", async () => {
		const { conv, locals } = await newConversation();
		scriptRounds([ASK, { content: "SQLite, then." }]);
		const elicitationId = await parkOnQuestion(conv, locals);
		const parked = lastAssistant(await reload(conv));
		await sendMessage(conv, locals, "Actually, never mind: use SQLite.");

		await answerOverHttp(conv, locals, elicitationId);

		expect(await resumeAnsweredAsk({ conversationId: conv._id, elicitationId })).toEqual({
			outcome: "not_claimed",
		});
		expect(mocks.create).toHaveBeenCalledTimes(2);
		const settled = (await reload(conv)).messages.find((m) => m.id === parked.id);
		if (!settled) throw new Error("parked message vanished");
		expect(settlements(settled, elicitationId)).toHaveLength(1);
		expect(toolResults(settled)).toHaveLength(1);
		expect(await turnStatus(conv, parked.id)).toBe("done");
	});
});
