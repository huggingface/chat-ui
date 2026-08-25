import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { parseToolArguments } from "./toolArgs";
import type { NormalizedToolCall } from "./toolInvocation";
import type { BuiltinTool } from "../builtinTools/types";
import type { McpToolTextResponse } from "$lib/server/mcp/httpClient";
import type { ChatCompletionToolMessageParam } from "openai/resources/chat/completions";

const mcpMock = vi.hoisted(() => ({
	callMcpTool: vi.fn(),
}));

vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: mcpMock.callMcpTool,
	getMcpToolTimeoutMs: () => 1_000,
}));

vi.mock("$lib/server/mcp/clientPool", () => ({
	getClient: vi.fn(async () => ({})),
}));

vi.mock("../../logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { executeToolCalls, isValidJsonObject } = await import("./toolInvocation");

const SERVERS = [{ name: "hf", url: "https://example.test/mcp" }];
const MAPPING = { do_thing: { fnName: "do_thing", server: "hf", tool: "do_thing" } };
const CALL: NormalizedToolCall = { id: "call_1", name: "do_thing", arguments: '{"a":1}' };

const toPrimitive = (value: unknown) =>
	typeof value === "string" || typeof value === "number" || typeof value === "boolean"
		? value
		: undefined;

const processToolOutput = (text: string) => ({ annotated: text, sources: [] });

async function drain(
	calls: NormalizedToolCall[],
	elicitation?: { conversationId: ObjectId; generationId?: string; messageId?: string },
	builtinTools?: BuiltinTool[]
) {
	const events = [];
	for await (const event of executeToolCalls({
		calls,
		mapping: MAPPING,
		servers: SERVERS,
		parseArgs: parseToolArguments,
		toPrimitive,
		processToolOutput,
		...(elicitation ? { elicitation } : {}),
		...(builtinTools ? { builtinTools } : {}),
	})) {
		events.push(event);
	}
	return events;
}

type Events = Awaited<ReturnType<typeof drain>>;

function summaryOf(events: Events) {
	const complete = events.find((e) => e.type === "complete");
	if (complete?.type !== "complete") throw new Error("no completion event");
	return complete.summary;
}

function toolMessagesOf(events: Events) {
	return summaryOf(events).toolMessages.filter(
		(message): message is ChatCompletionToolMessageParam => message.role === "tool"
	);
}

function toolUpdatesOf(events: Events) {
	return events.flatMap((e) =>
		e.type === "update" && e.update.type === MessageUpdateType.Tool ? [e.update] : []
	);
}

function mcpResult(overrides: Partial<McpToolTextResponse>): McpToolTextResponse {
	return { text: "", isError: false, ...overrides };
}

beforeEach(() => {
	mcpMock.callMcpTool.mockReset();
	mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "ok" }));
});

describe("executeToolCalls", () => {
	it("reports a successful call as a success", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "all good" }));

		const events = await drain([CALL]);

		expect(toolMessagesOf(events)).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "all good" },
		]);
		expect(summaryOf(events).toolRuns).toHaveLength(1);
		const result = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Result);
		expect(result).toBeDefined();
		if (result?.subtype === MessageToolUpdateType.Result) {
			expect(result.result.status).toBe(ToolResultStatus.Success);
		}
	});

	// MCP reports tool failures as a normal result with `isError: true` rather than by
	// throwing, so this path never reaches the catch. Before the fix it was reported to
	// both the user and the model as a success.
	it("reports an isError result as a failure and tells the model", async () => {
		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({ text: "repo not found: acme/missing", isError: true })
		);

		const events = await drain([CALL]);

		expect(toolMessagesOf(events)).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "Error: repo not found: acme/missing" },
		]);
		// A failed call produced no output, so it must not appear as a completed run.
		expect(summaryOf(events).toolRuns).toHaveLength(0);

		const updates = toolUpdatesOf(events);
		expect(updates.some((u) => u.subtype === MessageToolUpdateType.Result)).toBe(false);
		const error = updates.find((u) => u.subtype === MessageToolUpdateType.Error);
		expect(error).toBeDefined();
		if (error?.subtype === MessageToolUpdateType.Error) {
			expect(error.message).toBe("repo not found: acme/missing");
		}
	});

	it("falls back to a placeholder when an isError result carries no text", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "   ", isError: true }));

		const events = await drain([CALL]);

		expect(toolMessagesOf(events)[0]).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "Error: The tool reported an error with no message.",
		});
	});

	it("still reports a thrown transport error as a failure", async () => {
		mcpMock.callMcpTool.mockRejectedValue(new Error("connection refused"));

		const events = await drain([CALL]);

		expect(toolMessagesOf(events)[0]).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "Error: connection refused",
		});
	});
});

describe("executeToolCalls argument handling", () => {
	// Regression: undecodable arguments used to be coerced to `{}` and dispatched.
	it("does not dispatch a call whose arguments are truncated JSON", async () => {
		const events = await drain([
			{ id: "call_1", name: "do_thing", arguments: '{"path":"train.py","content":"import tor' },
		]);

		expect(mcpMock.callMcpTool).not.toHaveBeenCalled();

		expect(summaryOf(events).toolRuns).toHaveLength(0);
		const toolMessages = toolMessagesOf(events);
		expect(toolMessages).toHaveLength(1);
		expect(toolMessages[0].tool_call_id).toBe("call_1");
		expect(String(toolMessages[0].content)).toContain("Invalid tool arguments");

		const error = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Error);
		expect(error).toBeDefined();
	});

	it("still dispatches a call that takes no arguments", async () => {
		const events = await drain([{ id: "call_1", name: "do_thing", arguments: "" }]);

		expect(mcpMock.callMcpTool).toHaveBeenCalledTimes(1);
		expect(mcpMock.callMcpTool.mock.calls[0][2]).toEqual({});
		expect(summaryOf(events).toolRuns).toHaveLength(1);
	});

	it("dispatches valid calls in a batch even when a sibling call is malformed", async () => {
		const events = await drain([
			{ id: "call_1", name: "do_thing", arguments: '{"broken":' },
			{ id: "call_2", name: "do_thing", arguments: '{"ok":true}' },
		]);

		expect(mcpMock.callMcpTool).toHaveBeenCalledTimes(1);

		// Collated in call order, so the model can match each outcome to its call.
		const toolMessages = toolMessagesOf(events);
		expect(toolMessages.map((m) => m.tool_call_id)).toEqual(["call_1", "call_2"]);
		expect(String(toolMessages[0].content)).toContain("Invalid tool arguments");
		expect(toolMessages[1].content).toBe("ok");
	});
});

describe("isValidJsonObject", () => {
	it("accepts a well-formed JSON object", () => {
		expect(isValidJsonObject('{"city":"Paris"}')).toBe(true);
		expect(isValidJsonObject("{}")).toBe(true);
	});

	it("rejects malformed or truncated JSON", () => {
		// The exact failure mode this guards: a model streams a truncated
		// arguments string, which must never be persisted as argumentsRaw and
		// later replayed as an invalid historical tool_calls.function.arguments.
		expect(isValidJsonObject('{"city":"Pari')).toBe(false);
		expect(isValidJsonObject("")).toBe(false);
		expect(isValidJsonObject("not json at all")).toBe(false);
	});

	it("rejects valid JSON that isn't an object", () => {
		// Tool-call arguments must be an object; arrays/primitives/null are
		// syntactically valid JSON but never a valid arguments shape.
		expect(isValidJsonObject("[1,2,3]")).toBe(false);
		expect(isValidJsonObject("null")).toBe(false);
		expect(isValidJsonObject('"a string"')).toBe(false);
		expect(isValidJsonObject("42")).toBe(false);
	});
});

describe("builtin tool dispatch", () => {
	const ASK: NormalizedToolCall = {
		id: "call_ask",
		name: "ask_user_question",
		arguments:
			'{"questions":[{"question":"Which?","header":"Which","multiSelect":false,"options":[]}]}',
	};
	const CHAT = { conversationId: new ObjectId(), messageId: "m1" };

	const execute = vi.fn<BuiltinTool["execute"]>();
	const parkingBuiltin: BuiltinTool = {
		name: "ask_user_question",
		definition: { type: "function", function: { name: "ask_user_question" } },
		mayPark: true,
		parkRefusalMessage:
			"Only one ask_user_question call can be answered per turn. " +
			"Put every question in a single call's `questions` array.",
		execute,
	};

	beforeEach(() => {
		execute.mockReset();
		execute.mockImplementation(async (_args, ctx) =>
			ctx.elicitationSink
				? { awaitingInput: true }
				: { error: "The question could not be shown (no chat to ask)." }
		);
	});

	it("parks the run instead of looking for a server to call", async () => {
		const events = await drain([ASK], CHAT, [parkingBuiltin]);

		expect(mcpMock.callMcpTool).not.toHaveBeenCalled();
		expect(summaryOf(events).awaitingInput).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0][0]).toMatchObject({ questions: [{ question: "Which?" }] });
		expect(execute.mock.calls[0][1]).toMatchObject({ toolCallId: "call_ask", messageId: "m1" });
		expect(execute.mock.calls[0][1].elicitationSink).toBeDefined();
	});

	it("is an error, not a silent skip, when the builtin reports one", async () => {
		execute.mockResolvedValue({
			error: "The question could not be shown (no questions were given).",
		});
		const events = await drain([ASK], CHAT, [parkingBuiltin]);

		expect(summaryOf(events).awaitingInput).toBeUndefined();
		const errors = toolUpdatesOf(events).filter((u) => u.subtype === MessageToolUpdateType.Error);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			message: expect.stringContaining("no questions were given"),
		});
	});

	it("takes only one parking call per round, and tells the model why", async () => {
		const second: NormalizedToolCall = { ...ASK, id: "call_ask_2" };
		const events = await drain([ASK, second], CHAT, [parkingBuiltin]);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(summaryOf(events).awaitingInput).toBe(true);

		const errors = toolUpdatesOf(events).filter((u) => u.subtype === MessageToolUpdateType.Error);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			message: expect.stringContaining("single call's `questions` array"),
		});
	});

	it("hands the builtin no sink when there is no chat behind the call", async () => {
		const events = await drain([ASK], undefined, [parkingBuiltin]);

		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0][1].elicitationSink).toBeUndefined();
		expect(summaryOf(events).awaitingInput).toBeUndefined();
		expect(
			toolUpdatesOf(events).filter((u) => u.subtype === MessageToolUpdateType.Error)
		).toHaveLength(1);
	});

	it("streams a finished builtin's result and extra updates, and collates in call order", async () => {
		const planBuiltin: BuiltinTool = {
			name: "update_plan",
			definition: { type: "function", function: { name: "update_plan" } },
			execute: async (_args, ctx) => ({
				resultText: "PLAN (v1 — 0/1 done)",
				extraUpdates: [
					{
						type: MessageUpdateType.Plan,
						uuid: ctx.uuid,
						goal: "ship it",
						steps: [{ step: "do the thing", status: "pending" }],
						version: 1,
					},
				],
			}),
		};
		const events = await drain(
			[CALL, { id: "call_plan", name: "update_plan", arguments: '{"goal":"ship it"}' }],
			CHAT,
			[planBuiltin]
		);

		expect(mcpMock.callMcpTool).toHaveBeenCalledTimes(1);
		const planUpdates = events.flatMap((e) =>
			e.type === "update" && e.update.type === MessageUpdateType.Plan ? [e.update] : []
		);
		expect(planUpdates).toHaveLength(1);
		expect(planUpdates[0]).toMatchObject({ goal: "ship it", version: 1 });

		const results = toolUpdatesOf(events).filter((u) => u.subtype === MessageToolUpdateType.Result);
		expect(results).toHaveLength(2);
		// Original call order survives finish-order streaming.
		expect(toolMessagesOf(events).map((m) => m.tool_call_id)).toEqual(["call_1", "call_plan"]);
		expect(toolMessagesOf(events)[1].content).toBe("PLAN (v1 — 0/1 done)");
	});

	it("reports a builtin that throws as a failure instead of crashing the round", async () => {
		const throwing: BuiltinTool = {
			name: "update_plan",
			definition: { type: "function", function: { name: "update_plan" } },
			execute: async () => {
				throw new Error("db down");
			},
		};
		const events = await drain([{ id: "call_plan", name: "update_plan", arguments: "{}" }], CHAT, [
			throwing,
		]);

		expect(toolMessagesOf(events)[0]).toEqual({
			role: "tool",
			tool_call_id: "call_plan",
			content: "Error: db down",
		});
	});
});
