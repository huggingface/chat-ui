import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	isMessageElicitationRequestUpdate,
	isMessageElicitationResolvedUpdate,
} from "$lib/utils/messageUpdates";

/**
 * The tool call is stubbed rather than served over a socket: what is under test is which
 * branch a resume takes, and a real server would drag protocol negotiation, the shared
 * client pool and MCP_* config into a unit test.
 */
const calls = vi.hoisted(() => ({ queue: [] as unknown[], seen: [] as unknown[] }));
vi.mock("./httpClient", () => ({
	getMcpToolTimeoutMs: () => 1000,
	callMcpTool: async (
		_server: unknown,
		tool: string,
		args: unknown,
		opts: { resume?: unknown }
	) => {
		calls.seen.push({ tool, args, resume: opts?.resume });
		return calls.queue.shift() ?? { text: "", isError: false };
	},
}));

await ready;

const SERVERS = [{ name: "Mock", url: "http://mock.invalid/mcp" }];
const { resumeParkedToolCall } = await import("./resumeElicitation");

async function park(
	conversationId: ObjectId,
	inputKey: string,
	requestState: string | undefined,
	content: Record<string, string>
) {
	const elicitationId = crypto.randomUUID();
	await collections.mcpElicitations.insertOne({
		_id: new ObjectId(),
		elicitationId,
		conversationId,
		status: "resolved",
		action: "accept",
		content,
		request: { elicitationId, server: "Mock", mode: "form", message: "?", fields: [] },
		pending: {
			server: "Mock",
			tool: "confirm_twice",
			args: { a: 1 },
			inputKey,
			messageId: "m1",
			toolCallId: "c1",
			toolUuid: "u1",
			...(requestState !== undefined ? { requestState } : {}),
		},
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return elicitationId;
}

const askAgain = (message: string, requestState: string) => ({
	text: "",
	isError: false,
	inputRequired: {
		requestState,
		inputRequests: {
			second: {
				method: "elicitation/create",
				params: {
					message,
					requestedSchema: { type: "object", properties: { sure: { type: "string" } } },
				},
			},
		},
	},
});

describe("resuming a parked tool call", () => {
	beforeEach(() => {
		calls.queue.length = 0;
		calls.seen.length = 0;
	});

	it("replays the answer and the opaque state to the same tool", async () => {
		calls.queue.push({ text: "done", isError: false });
		const conversationId = new ObjectId();
		const id = await park(conversationId, "first", "asked-once", { ok: "yes" });

		await resumeParkedToolCall({ conversationId, elicitationId: id, extraServers: SERVERS });

		expect(calls.seen).toEqual([
			{
				tool: "confirm_twice",
				args: { a: 1 },
				resume: {
					requestState: "asked-once",
					inputResponses: { first: { action: "accept", content: { ok: "yes" } } },
				},
			},
		]);
	});

	it("parks again when the tool asks a second time", async () => {
		// Returning here instead would hand the model a round that never produced a result.
		calls.queue.push(askAgain("Are you sure?", "asked-twice"));
		const conversationId = new ObjectId();
		const id = await park(conversationId, "first", "asked-once", { ok: "yes" });

		const round1 = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(round1.parkedAgain).toBe(true);
		// The answered prompt settles first, so a reloaded transcript stops showing it as an
		// open form and can render what was submitted.
		expect(round1.updates.find(isMessageElicitationResolvedUpdate)).toMatchObject({
			action: "accept",
			content: { ok: "yes" },
		});

		const prompt = round1.updates.find(isMessageElicitationRequestUpdate);
		expect(prompt?.request.message).toBe("Are you sure?");
		// A durable prompt carries no deadline, so the UI shows no countdown.
		expect(prompt?.expiresAt).toBeUndefined();

		const stored = await collections.mcpElicitations.findOne({
			elicitationId: prompt?.request.elicitationId,
		});
		expect(stored?.pending).toMatchObject({ requestState: "asked-twice", inputKey: "second" });
	});

	it("returns the tool result once the last question is answered", async () => {
		calls.queue.push({ text: "all done", isError: false });
		const conversationId = new ObjectId();
		const id = await park(conversationId, "second", "asked-twice", { sure: "yes" });

		const done = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(done.parkedAgain).toBeUndefined();
		expect(done.updates.find(isMessageElicitationResolvedUpdate)).toBeDefined();
		const result = done.updates.find((u) => u.type === "tool" && u.subtype === "result") as
			undefined | { result: { outputs: { text?: string }[] } };
		expect(result?.result.outputs[0]?.text).toBe("all done");
	});

	it("surfaces a failing tool call as an error on the same block", async () => {
		calls.queue.push({ text: "it broke", isError: true });
		const conversationId = new ObjectId();
		const id = await park(conversationId, "second", undefined, { sure: "yes" });

		const done = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(done.updates.find((u) => u.type === "tool" && u.subtype === "error")).toMatchObject({
			uuid: "u1",
			message: "it broke",
		});
	});

	it("will not resume another conversation's prompt", async () => {
		// The id alone is not authority: a page open on a different conversation must not
		// continue this one's tool call.
		calls.queue.push({ text: "should never run", isError: false });
		const owner = new ObjectId();
		const id = await park(owner, "first", "asked-once", { ok: "yes" });

		const outcome = await resumeParkedToolCall({
			conversationId: new ObjectId(),
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(outcome).toMatchObject({ resumed: false });
		expect(calls.seen).toHaveLength(0);
		// and the real owner can still resume it afterwards
		const mine = await resumeParkedToolCall({
			conversationId: owner,
			elicitationId: id,
			extraServers: SERVERS,
		});
		expect(mine.resumed).toBe(true);
		expect(calls.seen).toHaveLength(1);
	});

	it("reports a prompt it cannot resume rather than pretending", async () => {
		const outcome = await resumeParkedToolCall({
			conversationId: new ObjectId(),
			elicitationId: crypto.randomUUID(),
			extraServers: SERVERS,
		});

		expect(outcome).toMatchObject({ resumed: false });
		expect(outcome.updates).toHaveLength(0);
		expect(calls.seen).toHaveLength(0);
	});
});

describe("resuming the model's own question", () => {
	async function parkAsk(
		conversationId: ObjectId,
		action: "accept" | "decline",
		content?: Record<string, string | string[]>
	) {
		const elicitationId = crypto.randomUUID();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			status: "resolved",
			action,
			...(content ? { content } : {}),
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
						title: "Storage",
						description: "Where should uploads go?",
						required: true,
						multiple: false,
						options: [
							{ value: "S3", label: "S3" },
							{ value: "Disk", label: "Disk" },
						],
					},
				],
			},
			pending: { kind: "ask", messageId: "m1", toolCallId: "c1", toolUuid: "u1" },
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		return elicitationId;
	}

	beforeEach(() => {
		calls.queue.length = 0;
		calls.seen.length = 0;
	});

	it("hands the answer straight back without calling any server", async () => {
		const conversationId = new ObjectId();
		const id = await parkAsk(conversationId, "accept", { q1: "S3" });

		const outcome = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(calls.seen).toHaveLength(0);
		expect(outcome).toMatchObject({ resumed: true });
		expect(outcome.parkedAgain).toBeUndefined();

		const result = outcome.updates.find(
			(u) => "subtype" in u && u.subtype === "result"
		) as unknown as { result: { outputs: Array<{ text: string }> } };
		expect(result.result.outputs[0].text).toContain("Where should uploads go?");
		expect(result.result.outputs[0].text).toContain("S3");
	});

	it("settles the prompt so a reloaded transcript stops showing it open", async () => {
		const conversationId = new ObjectId();
		const id = await parkAsk(conversationId, "accept", { q1: "S3" });

		const outcome = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(outcome.updates.filter(isMessageElicitationResolvedUpdate)).toHaveLength(1);
	});

	it("tells the model to carry on when the question was skipped", async () => {
		const conversationId = new ObjectId();
		const id = await parkAsk(conversationId, "decline");

		const outcome = await resumeParkedToolCall({
			conversationId,
			elicitationId: id,
			extraServers: SERVERS,
		});

		const result = outcome.updates.find(
			(u) => "subtype" in u && u.subtype === "result"
		) as unknown as { result: { outputs: Array<{ text: string }> } };
		expect(result.result.outputs[0].text).toMatch(/best judgement/);
	});

	it("will not answer a question asked in another conversation", async () => {
		const id = await parkAsk(new ObjectId(), "accept", { q1: "S3" });

		const outcome = await resumeParkedToolCall({
			conversationId: new ObjectId(),
			elicitationId: id,
			extraServers: SERVERS,
		});

		expect(outcome).toMatchObject({ resumed: false });
		expect(outcome.updates).toHaveLength(0);
	});
});

describe("which turn a parked call belongs to", () => {
	it("comes from the record, not from whatever was sent since", async () => {
		const { parkedMessageId } = await import("./elicitation");
		const conversationId = new ObjectId();
		const elicitationId = crypto.randomUUID();
		await collections.mcpElicitations.insertOne({
			_id: new ObjectId(),
			elicitationId,
			conversationId,
			status: "pending",
			request: { elicitationId, server: "", mode: "form", message: "?", fields: [] },
			pending: { kind: "ask", messageId: "parked-message", toolCallId: "c1", toolUuid: "u1" },
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		expect(await parkedMessageId(conversationId, elicitationId)).toBe("parked-message");
		// Another conversation holding the id is not entitled to the answer.
		expect(await parkedMessageId(new ObjectId(), elicitationId)).toBeUndefined();
	});
});
