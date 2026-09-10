import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Client } from "@modelcontextprotocol/client";
import { collections, ready } from "$lib/server/database";
import type { McpElicitation } from "$lib/types/McpElicitation";
import type { TurnStatus } from "$lib/types/TurnState";
import {
	handleElicitationRequest,
	submitElicitationAnswer,
	withElicitationContext,
	type ElicitationSink,
} from "./elicitation";
import {
	MessageElicitationUpdateType,
	MessageUpdateType,
	type MessageElicitationRequestUpdate,
	type MessageElicitationResolvedUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

const elicitationTimeoutMs = vi.hoisted(() => ({ value: 30_000 }));
vi.mock("./elicitationConfig", () => ({
	isElicitationEnabled: () => true,
	getElicitationTimeoutMs: () => elicitationTimeoutMs.value,
}));

await ready;

const FORM_PARAMS = {
	message: "What is your name?",
	requestedSchema: {
		type: "object",
		properties: { name: { type: "string" } },
		required: ["name"],
	},
};

// `withElicitationContext` only uses the client as a map key, so a bare object is enough.
const newClient = () => ({}) as Client;

function makeSink(conversationId: ObjectId, generationId: string) {
	const updates: MessageUpdate[] = [];
	const sink: ElicitationSink = {
		conversationId,
		generationId,
		emit: (update) => updates.push(update),
	};
	return { sink, updates };
}

/** Records pause/resume so tests can assert the tool call's clock actually stops. */
const spyDeadline = () => {
	const calls: string[] = [];
	return {
		calls,
		pause: () => void calls.push("pause"),
		resume: () => void calls.push("resume"),
	};
};

const context = (
	sink: ElicitationSink,
	overrides: Partial<{
		toolUuid: string;
		signal: AbortSignal;
		deadline: ReturnType<typeof spyDeadline>;
	}> = {}
) => ({
	sink,
	server: "Test Server",
	toolUuid: "tool-1",
	deadline: spyDeadline(),
	...overrides,
});

const requestUpdates = (updates: MessageUpdate[]) =>
	updates.filter(
		(u): u is MessageElicitationRequestUpdate =>
			u.type === MessageUpdateType.Elicitation && u.subtype === MessageElicitationUpdateType.Request
	);

const resolvedUpdate = (updates: MessageUpdate[]) =>
	updates.find(
		(u): u is MessageElicitationResolvedUpdate =>
			u.type === MessageUpdateType.Elicitation &&
			u.subtype === MessageElicitationUpdateType.Resolved
	);

async function waitForRequest(updates: MessageUpdate[]): Promise<MessageElicitationRequestUpdate> {
	for (let i = 0; i < 200; i++) {
		const [first] = requestUpdates(updates);
		if (first) return first;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("no elicitation request was emitted");
}

describe("elicitation routing", () => {
	beforeEach(async () => {
		elicitationTimeoutMs.value = 30_000;
		await collections.mcpElicitations.deleteMany({});
	});

	it("cancels when no tool call is in flight on the connection", async () => {
		// e.g. a server eliciting during a tool listing, where there is no chat to ask.
		const result = await handleElicitationRequest(newClient(), FORM_PARAMS);

		expect(result).toEqual({ action: "cancel" });
		expect(await collections.mcpElicitations.countDocuments({})).toBe(0);
	});

	it("cancels rather than guess between two generations sharing a pooled client", async () => {
		const client = newClient();
		const a = makeSink(new ObjectId(), "gen-a");
		const b = makeSink(new ObjectId(), "gen-b");

		const result = await withElicitationContext(client, context(a.sink), () =>
			withElicitationContext(client, context(b.sink), () =>
				handleElicitationRequest(client, FORM_PARAMS)
			)
		);

		// Routing either way would show one user's prompt in the other's conversation.
		expect(result).toEqual({ action: "cancel" });
		expect(a.updates).toHaveLength(0);
		expect(b.updates).toHaveLength(0);
	});

	it("cancels even when two generations claim the same id", async () => {
		// generationId comes from the request body, so it cannot be the audience check.
		const client = newClient();
		const a = makeSink(new ObjectId(), "same-id");
		const b = makeSink(new ObjectId(), "same-id");

		const result = await withElicitationContext(client, context(a.sink), () =>
			withElicitationContext(client, context(b.sink), () =>
				handleElicitationRequest(client, FORM_PARAMS)
			)
		);

		expect(result).toEqual({ action: "cancel" });
		expect(a.updates).toHaveLength(0);
		expect(b.updates).toHaveLength(0);
	});

	it("attributes the prompt to the tool call when only one is running", async () => {
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");

		const pending = withElicitationContext(client, context(sink, { toolUuid: "tool-42" }), () =>
			handleElicitationRequest(client, FORM_PARAMS)
		);

		const request = await waitForRequest(updates);
		expect(request.toolUuid).toBe("tool-42");
		expect(request.request).toMatchObject({
			server: "Test Server",
			mode: "form",
			message: "What is your name?",
		});

		await submitElicitationAnswer({
			elicitationId: request.request.elicitationId,
			conversationId: sink.conversationId,
			action: "accept",
			content: { name: "Ada" },
		});

		expect(await pending).toEqual({ action: "accept", content: { name: "Ada" } });
		expect(resolvedUpdate(updates)).toMatchObject({ action: "accept", resolution: "user" });
	});

	it("leaves the prompt unattributed when the same run has parallel calls", async () => {
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");

		const pending = withElicitationContext(client, context(sink, { toolUuid: "tool-1" }), () =>
			withElicitationContext(client, context(sink, { toolUuid: "tool-2" }), () =>
				handleElicitationRequest(client, FORM_PARAMS)
			)
		);

		const request = await waitForRequest(updates);
		// Same audience, so it is safe to show — but which of the two calls asked is unknown.
		expect(request.toolUuid).toBeUndefined();

		await submitElicitationAnswer({
			elicitationId: request.request.elicitationId,
			conversationId: sink.conversationId,
			action: "decline",
		});

		expect(await pending).toEqual({ action: "decline" });
	});

	it("stops the tool call's clock for as long as the prompt is open", async () => {
		// Without this the call expires underneath a user who takes their time.
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const deadline = spyDeadline();

		const pending = withElicitationContext(client, context(sink, { deadline }), () =>
			handleElicitationRequest(client, FORM_PARAMS)
		);

		const request = await waitForRequest(updates);
		expect(deadline.calls).toEqual(["pause"]);

		await submitElicitationAnswer({
			elicitationId: request.request.elicitationId,
			conversationId: sink.conversationId,
			action: "accept",
			content: { name: "Ada" },
		});
		await pending;

		expect(deadline.calls).toEqual(["pause", "resume"]);
	});

	it("restarts the clock even when nobody answers", async () => {
		elicitationTimeoutMs.value = 300;
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const deadline = spyDeadline();

		const result = await withElicitationContext(client, context(sink, { deadline }), () =>
			handleElicitationRequest(client, FORM_PARAMS)
		);

		expect(result).toEqual({ action: "cancel" });
		expect(resolvedUpdate(updates)).toMatchObject({ action: "cancel", resolution: "expired" });
		expect(deadline.calls).toEqual(["pause", "resume"]);
	});

	it("stops every call in the round, not just the one it picked", async () => {
		// Which of the parallel calls asked is unknowable.
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const first = spyDeadline();
		const second = spyDeadline();

		const pending = withElicitationContext(client, context(sink, { deadline: first }), () =>
			withElicitationContext(client, context(sink, { deadline: second }), () =>
				handleElicitationRequest(client, FORM_PARAMS)
			)
		);

		const request = await waitForRequest(updates);
		expect(first.calls).toEqual(["pause"]);
		expect(second.calls).toEqual(["pause"]);

		await submitElicitationAnswer({
			elicitationId: request.request.elicitationId,
			conversationId: sink.conversationId,
			action: "cancel",
		});
		await pending;

		expect(first.calls).toEqual(["pause", "resume"]);
		expect(second.calls).toEqual(["pause", "resume"]);
	});

	it("closes the prompt when the server withdraws its request", async () => {
		// Servers time out their own request (60s by SDK default) and cancel it.
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const server = new AbortController();

		const pending = withElicitationContext(client, context(sink), () =>
			handleElicitationRequest(client, FORM_PARAMS, server.signal)
		);

		await waitForRequest(updates);
		server.abort();

		expect(await pending).toEqual({ action: "cancel" });
		expect(resolvedUpdate(updates)).toMatchObject({ resolution: "withdrawn" });
	});

	it("blames the user's stop, not the server, when both give up", async () => {
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const generation = new AbortController();
		const server = new AbortController();

		const pending = withElicitationContext(
			client,
			context(sink, { signal: generation.signal }),
			() => handleElicitationRequest(client, FORM_PARAMS, server.signal)
		);

		await waitForRequest(updates);
		// Stopping the response is what makes the server hang up.
		generation.abort();
		server.abort();

		await pending;
		expect(resolvedUpdate(updates)).toMatchObject({ resolution: "aborted" });
	});

	it("stops waiting when the generation is aborted", async () => {
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");
		const controller = new AbortController();

		const pending = withElicitationContext(
			client,
			context(sink, { signal: controller.signal }),
			() => handleElicitationRequest(client, FORM_PARAMS)
		);

		await waitForRequest(updates);
		controller.abort();

		expect(await pending).toEqual({ action: "cancel" });
		expect(resolvedUpdate(updates)).toMatchObject({ resolution: "aborted" });
	});

	it("declines an unsupported request without recording it", async () => {
		const client = newClient();
		const { sink, updates } = makeSink(new ObjectId(), "gen-1");

		const result = await withElicitationContext(client, context(sink), () =>
			handleElicitationRequest(client, { mode: "url", message: "Sign in", url: "javascript:1" })
		);

		expect(result).toEqual({ action: "cancel" });
		expect(updates).toHaveLength(0);
		expect(await collections.mcpElicitations.countDocuments({})).toBe(0);
	});
});

describe("submitElicitationAnswer", () => {
	const conversationId = new ObjectId();

	const pendingRow = async (overrides: { expiresAt?: Date } = {}) => {
		const elicitationId = crypto.randomUUID();
		const now = new Date();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			status: "pending",
			request: {
				elicitationId,
				server: "Test Server",
				mode: "form",
				message: "What is your name?",
				fields: [{ kind: "string", name: "name", required: true }],
			},
			expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
			createdAt: now,
			updatedAt: now,
		});
		return elicitationId;
	};

	/** A 2026-era prompt: nothing waits on it, so the answer must start the continuation. */
	const durableRow = async ({
		turn = "awaiting_input",
		settled = false,
		closedBy,
	}: {
		turn?: TurnStatus;
		/** The parked message already carries the Resolved update a continuation writes. */
		settled?: boolean;
		/** Seed the row already closed by the system instead of pending. */
		closedBy?: "aborted" | "legacy";
	} = {}) => {
		const elicitationId = crypto.randomUUID();
		const messageId = crypto.randomUUID();
		const now = new Date();
		const closed: Pick<McpElicitation, "status" | "action" | "resolvedAt" | "resolution"> = closedBy
			? {
					status: "resolved",
					action: "cancel",
					resolvedAt: now,
					...(closedBy === "aborted" ? { resolution: "aborted" } : {}),
				}
			: { status: "pending" };
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			...closed,
			request: {
				elicitationId,
				source: "assistant",
				server: "",
				mode: "form",
				message: "",
				fields: [
					{
						kind: "select",
						name: "q1",
						required: true,
						multiple: false,
						options: [{ value: "a", label: "A" }],
					},
				],
			},
			pending: { kind: "ask", messageId, toolCallId: "call-1", toolUuid: "tool-1" },
			createdAt: now,
			updatedAt: now,
		});
		await collections.turnStates.insertOne({
			_id: new ObjectId(),
			conversationId,
			messageId,
			status: turn,
			producerId: "gen-1",
			createdAt: now,
			updatedAt: now,
		});
		await collections.conversations.insertOne({
			_id: conversationId,
			messages: [
				{
					id: messageId,
					from: "assistant",
					content: "",
					updates: settled
						? [
								{
									type: MessageUpdateType.Elicitation,
									subtype: MessageElicitationUpdateType.Resolved,
									elicitationId,
									action: "cancel",
									resolution: "user",
								},
							]
						: [],
				},
			],
			createdAt: now,
			updatedAt: now,
		} as never);
		return { elicitationId, messageId };
	};

	const answer = (elicitationId: string) =>
		submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { q1: "a" },
		});

	beforeEach(async () => {
		await Promise.all([
			collections.mcpElicitations.deleteMany({}),
			collections.turnStates.deleteMany({}),
			collections.generations.deleteMany({ conversationId }),
			collections.conversations.deleteMany({ _id: conversationId }),
		]);
	});

	it("records a validated answer", async () => {
		const elicitationId = await pendingRow();

		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { name: "Ada" },
		});

		// `resume: false` — a blocking prompt is already unblocked by the write itself.
		expect(result).toEqual({ ok: true, resume: false });
		const row = await collections.mcpElicitations.findOne({ elicitationId });
		expect(row).toMatchObject({
			status: "resolved",
			action: "accept",
			resolution: "user",
			content: { name: "Ada" },
		});
	});

	it("refuses an answer from another conversation", async () => {
		// Holding the id is not authority to answer a prompt raised somewhere else.
		const elicitationId = await pendingRow();

		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId: new ObjectId(),
			action: "accept",
			content: { name: "Mallory" },
		});

		expect(result).toMatchObject({ ok: false, status: 404 });
	});

	it("refuses an answer that does not match the requested schema", async () => {
		const elicitationId = await pendingRow();

		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { unexpected: "value" },
		});

		expect(result).toMatchObject({ ok: false, status: 400 });
		expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
			status: "pending",
		});
	});

	it("refuses a second answer", async () => {
		const elicitationId = await pendingRow();

		await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { name: "Ada" },
		});
		const second = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "decline",
		});

		// A blocking prompt was unblocked by the first write; there is nothing to pick up, so
		// no recovery data rides along.
		expect(second).toEqual({ ok: false, status: 409, error: "Already answered." });
	});

	it("refuses an answer after the server stopped waiting", async () => {
		const elicitationId = await pendingRow({ expiresAt: new Date(Date.now() - 1) });

		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { name: "Ada" },
		});

		expect(result).toMatchObject({ ok: false, status: 409 });
	});

	describe("a repeat answer to a durable prompt", () => {
		it("asks for the continuation the first answer never got", async () => {
			// The page that answered lost its cue (reloaded, closed, or its run died before it
			// persisted), so the transcript shows the question open again and the user answers
			// it a second time. Nothing picked up the answer, and the repeat is what can.
			const { elicitationId, messageId } = await durableRow();
			expect(await answer(elicitationId)).toEqual({ ok: true, resume: true, messageId });

			const repeat = await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "decline",
			});

			expect(repeat).toMatchObject({
				ok: false,
				status: 409,
				answered: { action: "accept", resume: true, messageId },
			});
			// The earlier answer stands: the repeat continues it, it does not replace it.
			expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
				action: "accept",
				resolution: "user",
				content: { q1: "a" },
			});
		});

		it("asks again after a continuation died before it persisted", async () => {
			// The reaper marks the generation and message interrupted but never moves the
			// turn state, so it reads `running` for good. That must not pass for continued.
			const { elicitationId, messageId } = await durableRow({ turn: "running" });
			await answer(elicitationId);

			const repeat = await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "decline",
			});

			expect(repeat).toMatchObject({
				ok: false,
				status: 409,
				answered: { action: "accept", resume: true, messageId },
			});
		});

		it("leaves a continuation that already ran alone, whatever the turn state says", async () => {
			const { elicitationId, messageId } = await durableRow({ turn: "running", settled: true });
			await answer(elicitationId);

			const repeat = await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "decline",
			});

			expect(repeat).toMatchObject({
				ok: false,
				status: 409,
				answered: { action: "accept", resume: false, messageId },
			});
		});

		it("leaves a continuation that is under way alone", async () => {
			const { elicitationId, messageId } = await durableRow();
			await answer(elicitationId);
			const now = new Date();
			await collections.generations.insertOne({
				_id: new ObjectId(),
				generationId: crypto.randomUUID(),
				conversationId,
				messageId,
				status: "running",
				seq: 0,
				lastHeartbeatAt: now,
				startedAt: now,
				createdAt: now,
				updatedAt: now,
			});

			const repeat = await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "decline",
			});

			expect(repeat).toMatchObject({
				ok: false,
				status: 409,
				answered: { action: "accept", resume: false, messageId },
			});
		});

		it("takes a real answer in place of a close the system wrote", async () => {
			// The run that asked was reaped before it wound down, which closed the row with a
			// cancel nobody consumed. The user's answer is the first real one.
			const { elicitationId, messageId } = await durableRow({ closedBy: "aborted" });

			expect(await answer(elicitationId)).toEqual({ ok: true, resume: true, messageId });
			expect(await collections.mcpElicitations.findOne({ elicitationId })).toMatchObject({
				status: "resolved",
				action: "accept",
				resolution: "user",
				content: { q1: "a" },
			});
		});

		it("reads a cancel from before resolutions were recorded as the system's", async () => {
			const { elicitationId, messageId } = await durableRow({ closedBy: "legacy" });

			expect(await answer(elicitationId)).toEqual({ ok: true, resume: true, messageId });
		});

		it("keeps a system close that a continuation already consumed", async () => {
			const { elicitationId, messageId } = await durableRow({ closedBy: "aborted", settled: true });

			expect(await answer(elicitationId)).toMatchObject({
				ok: false,
				status: 409,
				answered: { action: "cancel", resume: false, messageId },
			});
		});

		it("keeps the question open when it cannot tell whether the answer was continued", async () => {
			const { elicitationId } = await durableRow();
			await answer(elicitationId);
			const lookup = vi
				.spyOn(collections.conversations, "findOne")
				.mockRejectedValueOnce(new Error("blip"));

			const repeat = await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "decline",
			});
			lookup.mockRestore();

			// A refusal carrying `answered` would make the composer drop the question with no
			// continuation queued; a plain failure leaves it there to retry.
			expect(repeat).toMatchObject({ ok: false, status: 500 });
			expect(repeat).not.toHaveProperty("answered");
		});
	});
});

describe("submitElicitationAnswer budget grants", () => {
	const budgetAskRow = async (conversationId: ObjectId) => {
		const elicitationId = crypto.randomUUID();
		const now = new Date();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			status: "pending",
			request: {
				elicitationId,
				server: "",
				source: "assistant",
				mode: "form",
				message: "Proceed?",
				fields: [
					{
						kind: "select",
						name: "q1",
						required: true,
						multiple: false,
						allowOther: true,
						options: [
							{ value: "Rescope", label: "Rescope" },
							{ value: "Run in full", label: "Run in full", setBudgetUsd: 4.5 },
						],
					},
				],
			},
			pending: { kind: "ask", messageId: "m1", toolCallId: "c1", toolUuid: "u1" },
			createdAt: now,
			updatedAt: now,
		});
		return elicitationId;
	};

	const mlConversation = async (mlAssistant: boolean) => {
		const _id = new ObjectId();
		await collections.conversations.insertOne({
			_id,
			title: "grant test",
			model: "test-model",
			messages: [],
			createdAt: new Date(),
			updatedAt: new Date(),
			sessionId: `grant-${_id.toString()}`,
			...(mlAssistant ? { mlAssistant: true } : {}),
			...(mlAssistant
				? { mlBudget: { totalMicroUsd: 0, spentMicroUsd: 0, reservations: [] } }
				: {}),
		});
		return _id;
	};

	it("applies the chosen option's grant through the trusted path", async () => {
		const conversationId = await mlConversation(true);
		const elicitationId = await budgetAskRow(conversationId);

		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { q1: "Run in full" },
		});
		expect(result.ok).toBe(true);

		const conv = await collections.conversations.findOne({ _id: conversationId });
		expect(conv?.mlBudget?.totalMicroUsd).toBe(4_500_000);
	});

	it("grants nothing for the other option or typed text", async () => {
		const conversationId = await mlConversation(true);
		for (const answer of ["Rescope", "run in full please"]) {
			const elicitationId = await budgetAskRow(conversationId);
			await submitElicitationAnswer({
				elicitationId,
				conversationId,
				action: "accept",
				content: { q1: answer },
			});
		}
		const conv = await collections.conversations.findOne({ _id: conversationId });
		expect(conv?.mlBudget?.totalMicroUsd).toBe(0);
	});

	it("fails loudly outside ML Assistant conversations, leaving the prompt answerable", async () => {
		// An option smuggled into an ordinary conversation must not conjure a
		// budget — and must not resolve as if it had: a resolved answer would
		// tell the model the grant landed when the ledger never changed.
		const conversationId = await mlConversation(false);
		const elicitationId = await budgetAskRow(conversationId);
		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { q1: "Run in full" },
		});
		expect(result).toMatchObject({ ok: false, status: 500 });
		const conv = await collections.conversations.findOne({ _id: conversationId });
		expect(conv?.mlBudget).toBeUndefined();
		const row = await collections.mcpElicitations.findOne({ elicitationId });
		expect(row?.status).toBe("pending");
	});

	it("resolves nothing when the grant write cannot land", async () => {
		// Apply-before-resolve: a failed grant returns retryable and the prompt
		// stays pending, instead of a resolved answer claiming a phantom budget.
		const conversationId = new ObjectId(); // no conversation document at all
		const elicitationId = await budgetAskRow(conversationId);
		const result = await submitElicitationAnswer({
			elicitationId,
			conversationId,
			action: "accept",
			content: { q1: "Run in full" },
		});
		expect(result).toMatchObject({ ok: false, status: 500 });
		const row = await collections.mcpElicitations.findOne({ elicitationId });
		expect(row?.status).toBe("pending");
	});
});
