import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Client } from "@modelcontextprotocol/client";
import { collections, ready } from "$lib/server/database";
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

	beforeEach(async () => {
		await collections.mcpElicitations.deleteMany({});
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
		expect(row).toMatchObject({ status: "resolved", action: "accept", content: { name: "Ada" } });
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

		expect(second).toMatchObject({ ok: false, status: 409 });
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
});
