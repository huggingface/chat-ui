import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { parseToolArguments } from "./toolArgs";
import type { NormalizedToolCall, ToolArgsRewrite } from "./toolInvocation";
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

const { executeToolCalls, isValidJsonObject, withRewrittenArguments } =
	await import("./toolInvocation");
const { createVirtualFileExpander } = await import("$lib/server/mlFiles/expand");
const { writeMlFileVersion } = await import("$lib/server/mlFiles/store");

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
	builtinTools?: BuiltinTool[],
	guard?: import("./toolGuard").ToolCallGuard
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
		...(guard ? { guard } : {}),
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

describe("executeToolCalls durable elicitation", () => {
	it("records awaiting_input when a prompt opens, so the turn stays subscribable", async () => {
		// An MCP prompt parks the turn on the user exactly like the ask tool, but
		// this path recorded nothing: the route's ending CAS then read the state
		// as still-running and marked the turn done, closing every subscription
		// while the prompt was open — an answer from another tab streamed into
		// nothing.
		await ready;
		const conversationId = new ObjectId();
		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({
				inputRequired: {
					inputRequests: {
						name: {
							method: "elicitation/create",
							params: {
								message: "What is your name?",
								requestedSchema: {
									type: "object",
									properties: { name: { type: "string" } },
									required: ["name"],
								},
							},
						},
					},
				},
			} as Partial<McpToolTextResponse>)
		);

		const events = await drain([CALL], {
			conversationId,
			generationId: "gen-1",
			messageId: "assistant-1",
		});

		// The in-band transition, on the same channel as the prompt itself.
		const turnStates = events.flatMap((e) =>
			e.type === "update" && e.update.type === MessageUpdateType.TurnState ? [e.update] : []
		);
		expect(turnStates.map((u) => u.state)).toEqual(["awaiting_input"]);

		// And the authoritative document, so the ending CAS misses and the
		// parked state stands.
		const doc = await collections.turnStates.findOne({ conversationId, messageId: "assistant-1" });
		expect(doc?.status).toBe("awaiting_input");
		expect(doc?.producerId).toBe("gen-1");
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

describe("executeToolCalls with a guard", () => {
	function fakeGuard(overrides: Partial<import("./toolGuard").ToolCallGuard> = {}) {
		const before = vi.fn(async () => ({ allow: true }) as const);
		const after = vi.fn(async () => undefined);
		return {
			guard: { allowParking: false, before, after, ...overrides },
			before,
			after,
		};
	}

	it("consults the guard before dispatch and honors a refusal", async () => {
		const { guard, before, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: false, message: "over budget" }) as const),
		});
		const events = await drain([CALL], undefined, undefined, guard);

		expect(mcpMock.callMcpTool).not.toHaveBeenCalled();
		expect(after).not.toHaveBeenCalled();
		expect(before).toBeDefined();
		expect(toolMessagesOf(events)).toEqual([
			{ role: "tool", tool_call_id: "call_1", content: "Error: over budget" },
		]);
		const error = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Error);
		expect(error).toBeDefined();
	});

	it("hands the guard the raw server-side call, not the sanitized name", async () => {
		const { guard, before } = fakeGuard();
		await drain([CALL], undefined, undefined, guard);
		expect(before).toHaveBeenCalledWith(
			expect.objectContaining({
				serverUrl: "https://example.test/mcp",
				tool: "do_thing",
				args: { a: 1 },
			})
		);
	});

	it("reports a success outcome with the raw response text", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "job 123 started" }));
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});
		await drain([CALL], undefined, undefined, guard);
		expect(after).toHaveBeenCalledWith(
			{ key: "k" },
			{ status: "success", text: "job 123 started" }
		);
	});

	it("reports an isError outcome", async () => {
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "bad image", isError: true }));
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});
		await drain([CALL], undefined, undefined, guard);
		expect(after).toHaveBeenCalledWith({ key: "k" }, { status: "error", text: "bad image" });
	});

	it("hands the guard the result's structured part, untouched", async () => {
		const structured = { outcome: { kind: "job", job: { id: "0123456789abcdef01234567" } } };
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});

		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ text: "job started", structured }));
		await drain([CALL], undefined, undefined, guard);
		expect(after).toHaveBeenLastCalledWith(
			{ key: "k" },
			{ status: "success", text: "job started", structured }
		);

		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({ text: "bad image", isError: true, structured })
		);
		await drain([CALL], undefined, undefined, guard);
		expect(after).toHaveBeenLastCalledWith(
			{ key: "k" },
			{ status: "error", text: "bad image", structured }
		);
	});

	it("streams the result without the parts that repeat its text, and the guard still gets them", async () => {
		const structured = { job: { id: "0123456789abcdef01234567", status: "RUNNING" } };
		const image = { type: "image", data: "aGk=", mimeType: "image/png" };
		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({
				text: "job started",
				structured,
				content: [{ type: "text", text: "job started" }, image],
			})
		);
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});

		const events = await drain([CALL], undefined, undefined, guard);

		expect(after).toHaveBeenCalledWith(
			{ key: "k" },
			{ status: "success", text: "job started", structured }
		);
		const result = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Result);
		expect(result).toMatchObject({
			result: {
				status: ToolResultStatus.Success,
				call: { name: "do_thing", parameters: {} },
				outputs: [{ text: "job started", content: [image] }],
			},
		});
		if (result?.subtype === MessageToolUpdateType.Result) {
			expect(result.result).not.toHaveProperty("outputs.0.structured");
		}
	});

	it("streams structured when the tool answered with nothing else", async () => {
		const structured = { job: { id: "0123456789abcdef01234567" } };
		mcpMock.callMcpTool.mockResolvedValue(mcpResult({ structured, content: [] }));

		const events = await drain([CALL]);

		const result = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Result);
		expect(result).toMatchObject({ result: { outputs: [{ text: "", structured }] } });
		expect(result).not.toHaveProperty("result.outputs.0.content");
	});

	it("reports a transport failure", async () => {
		mcpMock.callMcpTool.mockRejectedValue(new Error("socket hang up"));
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});
		await drain([CALL], undefined, undefined, guard);
		expect(after).toHaveBeenCalledWith({ key: "k" }, { status: "transport_error" });
	});

	it("skips the after hook for unticketed calls", async () => {
		const { guard, after } = fakeGuard();
		await drain([CALL], undefined, undefined, guard);
		expect(after).not.toHaveBeenCalled();
	});

	it("declines elicitation on a ticketed call instead of parking it", async () => {
		mcpMock.callMcpTool.mockResolvedValue(
			mcpResult({
				inputRequired: {
					inputRequests: {
						dataset: {
							method: "elicitation/create",
							params: {
								message: "which dataset?",
								requestedSchema: { type: "object", properties: {} },
							},
						},
					},
				},
			} as Partial<McpToolTextResponse>)
		);
		const { guard, after } = fakeGuard({
			before: vi.fn(async () => ({ allow: true, ticket: { key: "k" } }) as const),
		});
		const events = await drain(
			[CALL],
			{ conversationId: new ObjectId(), messageId: "m1" },
			undefined,
			guard
		);

		expect(after).toHaveBeenCalledWith({ key: "k" }, { status: "elicited" });
		expect(summaryOf(events).awaitingInput).toBeUndefined();
		expect(toolMessagesOf(events)[0].content).toContain("Nothing was charged");
	});

	it("streams the budget updates the guard returns", async () => {
		const budgetUpdate = {
			type: MessageUpdateType.Budget,
			totalMicroUsd: 10,
			spentMicroUsd: 1,
			reservedMicroUsd: 2,
		} as const;
		const { guard } = fakeGuard({
			before: vi.fn(
				async () => ({ allow: true, ticket: { key: "k" }, update: budgetUpdate }) as const
			),
			after: vi.fn(async () => budgetUpdate),
		});
		const events = await drain([CALL], undefined, undefined, guard);
		const budgets = events.filter(
			(e) => e.type === "update" && e.update.type === MessageUpdateType.Budget
		);
		expect(budgets).toHaveLength(2);
	});
});

describe("withRewrittenArguments", () => {
	const stamp: ToolArgsRewrite = ({ serverUrl, tool, args }) => ({
		...args,
		via: `${tool}@${serverUrl}`,
	});
	const options = {
		mapping: MAPPING,
		servers: SERVERS,
		parseArgs: parseToolArguments,
	};

	it("re-serialises a call the rewrite changed", () => {
		const [call] = withRewrittenArguments([CALL], { ...options, rewrite: stamp });

		expect(call.id).toBe(CALL.id);
		expect(call.name).toBe(CALL.name);
		expect(JSON.parse(call.arguments)).toEqual({ a: 1, via: "do_thing@https://example.test/mcp" });
	});

	it("keeps a call the rewrite left alone, string and all", () => {
		// Identity is the no-change signal; the original string stays byte for byte.
		const spaced: NormalizedToolCall = { ...CALL, arguments: '{ "a" : 1 }' };
		const [call] = withRewrittenArguments([spaced], { ...options, rewrite: ({ args }) => args });

		expect(call).toBe(spaced);
	});

	it("skips builtins, unmapped tools and undecodable arguments", () => {
		const rewrite = vi.fn(stamp);
		const builtin: BuiltinTool = {
			name: "do_thing",
			definition: { type: "function", function: { name: "do_thing" } },
			execute: async () => ({ resultText: "done" }),
		};
		const unmapped: NormalizedToolCall = { id: "call_2", name: "nope", arguments: "{}" };
		const broken: NormalizedToolCall = { id: "call_3", name: "do_thing", arguments: '{"broken":' };

		expect(
			withRewrittenArguments([CALL], { ...options, builtinTools: [builtin], rewrite })
		).toEqual([CALL]);
		expect(withRewrittenArguments([unmapped, broken], { ...options, rewrite })).toEqual([
			unmapped,
			broken,
		]);
		expect(rewrite).not.toHaveBeenCalled();
	});

	it("is what the executor persists and dispatches", async () => {
		// The point of rewriting the call rather than the dispatch: history,
		// the persisted Call update and the server all carry the same arguments.
		const calls = withRewrittenArguments([CALL], { ...options, rewrite: stamp });
		const events = await drain(calls);

		const expected = { a: 1, via: "do_thing@https://example.test/mcp" };
		expect(mcpMock.callMcpTool.mock.calls[0][2]).toEqual(expected);
		const call = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Call);
		expect(
			call?.subtype === MessageToolUpdateType.Call && call.argumentsRaw
				? JSON.parse(call.argumentsRaw)
				: undefined
		).toEqual(expected);
	});
});

describe("virtual file expansion at dispatch", () => {
	const HUB = { name: "hub", url: "https://huggingface.co/mcp?login&bouquet=intern" };
	const SERVERS_WITH_HUB = [...SERVERS, HUB];
	const MAPPING_WITH_HUB = {
		...MAPPING,
		hf_jobs: { fnName: "hf_jobs", server: "hub", tool: "hf_jobs" },
		hf_fs_write: { fnName: "hf_fs_write", server: "hub", tool: "hf_fs_write" },
		hf_sandbox_fs: { fnName: "hf_sandbox_fs", server: "hub", tool: "hf_sandbox_fs" },
		hf_jobs_2: { fnName: "hf_jobs_2", server: "hf", tool: "hf_jobs" },
	};

	async function seeded() {
		await ready;
		const conversationId = new ObjectId();
		await writeMlFileVersion({
			conversationId,
			name: "train.py",
			content: "print(1)",
			origin: "write",
		});
		await writeMlFileVersion({
			conversationId,
			name: "train.py",
			content: "print(2)",
			origin: "edit",
		});
		return { conversationId, expandVirtualFiles: createVirtualFileExpander(conversationId) };
	}

	async function drainExpanding(
		calls: NormalizedToolCall[],
		expandVirtualFiles: import("$lib/server/mlFiles/expand").VirtualFileExpander,
		extra: { guard?: import("./toolGuard").ToolCallGuard; builtinTools?: BuiltinTool[] } = {}
	) {
		const events = [];
		for await (const event of executeToolCalls({
			calls,
			mapping: MAPPING_WITH_HUB,
			servers: SERVERS_WITH_HUB,
			parseArgs: parseToolArguments,
			toPrimitive,
			processToolOutput,
			expandVirtualFiles,
			...extra,
		})) {
			events.push(event);
		}
		return events;
	}

	const callUpdateOf = (events: Events) => {
		const update = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Call);
		if (update?.subtype !== MessageToolUpdateType.Call) throw new Error("no call update");
		return update;
	};

	afterEach(async () => {
		await collections.mlFiles.deleteMany({});
	});

	it("sends the content to the server and keeps the reference everywhere else", async () => {
		const { expandVirtualFiles } = await seeded();
		const raw = '{"operation":"uv","args":{"script":"v-file://train.py","flavor":"cpu-basic"}}';

		const events = await drainExpanding(
			[{ id: "call_1", name: "hf_jobs", arguments: raw }],
			expandVirtualFiles
		);

		expect(mcpMock.callMcpTool.mock.calls[0][2]).toEqual({
			operation: "uv",
			args: { script: "print(2)", flavor: "cpu-basic" },
		});
		const call = callUpdateOf(events);
		expect(call.argumentsRaw).toBe(raw);
		expect(call.call.parameters).toEqual({ operation: "uv" });
		expect(call.fileRefs).toEqual([{ ref: "v-file://train.py", name: "train.py", version: 2 }]);
		expect(toolMessagesOf(events)[0].content).toBe("ok");
	});

	it("expands hf_fs_write content and the --text token of hf_sandbox_fs write", async () => {
		const { expandVirtualFiles } = await seeded();

		const events = await drainExpanding(
			[
				{
					id: "call_1",
					name: "hf_fs_write",
					arguments:
						'{"cmd":"put","args":["put","hf://models/o/n/train.py"],"content":"v-file://train.py@v1"}',
				},
				{
					id: "call_2",
					name: "hf_sandbox_fs",
					arguments:
						'{"cmd":"write","args":["write","hfsb2:o:1","/work/train.py","--text","v-file://train.py"]}',
				},
			],
			expandVirtualFiles
		);

		const dispatched = mcpMock.callMcpTool.mock.calls.map((c) => [c[1], c[2]]);
		expect(dispatched).toContainEqual([
			"hf_fs_write",
			{ cmd: "put", args: ["put", "hf://models/o/n/train.py"], content: "print(1)" },
		]);
		expect(dispatched).toContainEqual([
			"hf_sandbox_fs",
			{ cmd: "write", args: ["write", "hfsb2:o:1", "/work/train.py", "--text", "print(2)"] },
		]);
		const calls = toolUpdatesOf(events).filter((u) => u.subtype === MessageToolUpdateType.Call);
		expect(calls[0]).toMatchObject({
			call: { parameters: { cmd: "put", content: "v-file://train.py@v1" } },
			fileRefs: [{ ref: "v-file://train.py@v1", name: "train.py", version: 1 }],
		});
		expect(calls[1]).toMatchObject({
			fileRefs: [{ ref: "v-file://train.py", name: "train.py", version: 2 }],
		});
	});

	it("leaves a reference outside the allowlisted positions, or inside a longer string, alone", async () => {
		const { expandVirtualFiles } = await seeded();
		const inCommand =
			'{"operation":"run","args":{"image":"python:3.12","command":["v-file://train.py"]}}';
		const inProse = '{"operation":"uv","args":{"script":"# see v-file://train.py\\nprint(3)"}}';

		const events = await drainExpanding(
			[
				{ id: "call_1", name: "hf_jobs", arguments: inCommand },
				{ id: "call_2", name: "hf_jobs", arguments: inProse },
			],
			expandVirtualFiles
		);

		expect(mcpMock.callMcpTool.mock.calls.map((c) => c[2])).toEqual([
			JSON.parse(inCommand),
			JSON.parse(inProse),
		]);
		for (const update of toolUpdatesOf(events)) {
			if (update.subtype === MessageToolUpdateType.Call) expect(update.fileRefs).toBeUndefined();
		}
	});

	it("does not touch a same-named tool on a server that is not the Hub", async () => {
		const { expandVirtualFiles } = await seeded();
		const raw = '{"operation":"uv","args":{"script":"v-file://train.py"}}';

		await drainExpanding([{ id: "call_1", name: "hf_jobs_2", arguments: raw }], expandVirtualFiles);

		expect(mcpMock.callMcpTool.mock.calls[0][2]).toEqual(JSON.parse(raw));
	});

	it("refuses an unresolved reference before the guard, and lists what exists", async () => {
		const { expandVirtualFiles } = await seeded();
		const before = vi.fn(async () => ({ allow: true }) as const);
		const guard = { allowParking: false, before, after: vi.fn(async () => undefined) };

		const events = await drainExpanding(
			[
				{
					id: "call_1",
					name: "hf_jobs",
					arguments: '{"operation":"uv","args":{"script":"v-file://missing.py"}}',
				},
			],
			expandVirtualFiles,
			{ guard }
		);

		expect(before).not.toHaveBeenCalled();
		expect(mcpMock.callMcpTool).not.toHaveBeenCalled();
		const error = toolUpdatesOf(events).find((u) => u.subtype === MessageToolUpdateType.Error);
		expect(error).toMatchObject({
			message: expect.stringContaining("v-file://missing.py does not resolve"),
		});
		const [message] = toolMessagesOf(events);
		expect(String(message.content)).toContain("v-file://train.py (v2)");
		expect(summaryOf(events).toolRuns).toHaveLength(0);
	});

	it("never expands the arguments of a builtin tool", async () => {
		const { expandVirtualFiles } = await seeded();
		const execute = vi.fn<BuiltinTool["execute"]>(async () => ({ resultText: "stored" }));
		const builtin: BuiltinTool = {
			name: "hf_jobs",
			definition: { type: "function", function: { name: "hf_jobs" } },
			execute,
		};

		await drainExpanding(
			[
				{
					id: "call_1",
					name: "hf_jobs",
					arguments: '{"operation":"uv","args":{"script":"v-file://train.py"}}',
				},
			],
			expandVirtualFiles,
			{ builtinTools: [builtin] }
		);

		expect(execute.mock.calls[0][0]).toEqual({
			operation: "uv",
			args: { script: "v-file://train.py" },
		});
	});
});
