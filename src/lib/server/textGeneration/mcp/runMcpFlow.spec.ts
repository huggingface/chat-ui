import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { McpFlowResult, RunMcpFlowContext } from "./runMcpFlow";

// ---------------------------------------------------------------------------
// Harness
//
// runMcpFlow reaches a long way out — the router, the MCP registry, the OpenAI
// SDK, tool execution — so nothing in it was reachable from a test. Everything
// below stubs those edges and leaves the flow itself real, so a test can script
// what the upstream returns and assert on what the flow does with it.
//
// The `vi.mock` calls have to live in the spec file (they are hoisted per
// module), so extracting this into a fixture would only move the builders.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	executeToolCalls: vi.fn(),
	getAbortTime: vi.fn(() => undefined as number | undefined),
}));

vi.mock("openai", () => ({
	OpenAI: class {
		chat = { completions: { create: mocks.create } };
	},
}));

vi.mock("$lib/server/config", () => ({
	config: {
		OPENAI_BASE_URL: "https://router.test/v1",
		OPENAI_API_KEY: "sk-test",
		HF_TOKEN: "",
		MCP_FORWARD_HF_USER_TOKEN: "false",
		EXA_API_KEY: "",
		USE_USER_TOKEN: "false",
		isHuggingChat: false,
	},
}));

vi.mock("$lib/server/mcp/registry", () => ({
	getMcpServers: () => [{ name: "hf", url: "https://example.test/mcp" }],
}));

vi.mock("$lib/server/urlSafety", () => ({ isValidUrl: () => true }));

vi.mock("$lib/server/mcp/tools", () => ({
	getOpenAiToolsForMcp: async () => ({
		tools: [{ type: "function", function: { name: "do_thing" } }],
		mapping: { do_thing: { fnName: "do_thing", server: "hf", tool: "do_thing" } },
	}),
}));

vi.mock("./routerResolution", () => ({
	resolveRouterTarget: async ({ model }: { model: unknown }) => ({
		runMcp: true,
		targetModel: model,
	}),
}));

vi.mock("./toolInvocation", () => ({ executeToolCalls: mocks.executeToolCalls }));

vi.mock("$lib/server/textGeneration/utils/prepareFiles", () => ({
	prepareMessagesWithFiles: async (messages: Array<{ from: string; content: string }>) =>
		messages.map((m) => ({ role: m.from, content: m.content })),
}));

vi.mock("$lib/server/endpoints/images", () => ({ makeImageProcessor: () => () => undefined }));
vi.mock("./fileRefs", () => ({ buildImageRefResolver: () => undefined }));
vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/abortedGenerations", () => ({
	AbortedGenerations: { getInstance: () => ({ getAbortTime: mocks.getAbortTime }) },
}));

const { runMcpFlow } = await import("./runMcpFlow");

type ScriptedCall = { id?: string; name?: string; arguments: string };

/** One upstream completion: what it streams back, and how it ended. */
type Round = {
	content?: string;
	reasoning?: string;
	toolCalls?: ScriptedCall[];
	/** Defaults to "tool_calls" when the round emits calls, else "stop". */
	finishReason?: string;
	/** Throw instead of returning a stream, to script an upstream failure. */
	error?: Error;
};

function chunk(choice: Record<string, unknown>) {
	return { choices: [choice] };
}

function streamFor(round: Round) {
	return (async function* () {
		if (round.reasoning) yield chunk({ delta: { reasoning: round.reasoning } });
		if (round.content) yield chunk({ delta: { content: round.content } });
		for (const [index, call] of (round.toolCalls ?? []).entries()) {
			yield chunk({
				delta: {
					tool_calls: [
						{ index, id: call.id, function: { name: call.name, arguments: call.arguments } },
					],
				},
			});
		}
		yield chunk({
			delta: {},
			finish_reason: round.finishReason ?? (round.toolCalls?.length ? "tool_calls" : "stop"),
		});
	})();
}

/** Queue the upstream responses, in order. A missing round means the flow looped further than scripted. */
function scriptRounds(rounds: Round[]) {
	let next = 0;
	mocks.create.mockImplementation(async () => {
		const round = rounds[next++];
		if (!round) throw new Error(`upstream called ${next} times but only ${rounds.length} scripted`);
		if (round.error) throw round.error;
		return streamFor(round);
	});
}

/** Make every scripted tool call resolve with `output`. */
function scriptToolResults(output = "tool ok") {
	mocks.executeToolCalls.mockImplementation(async function* ({
		calls,
	}: {
		calls: Array<{ id: string; name: string }>;
	}) {
		for (const call of calls) {
			yield {
				type: "update",
				update: {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Call,
					uuid: call.id,
					call: { name: call.name, parameters: {} },
				},
			};
		}
		yield {
			type: "complete",
			summary: {
				toolMessages: calls.map((call) => ({
					role: "tool" as const,
					tool_call_id: call.id,
					content: output,
				})),
				toolRuns: calls.map((call) => ({ name: call.name, parameters: {}, output })),
			},
		};
	});
}

function context(): RunMcpFlowContext & { abortSignal?: AbortSignal } {
	return {
		model: { id: "test/model", name: "test/model", supportsTools: true, parameters: {} },
		conv: { _id: new ObjectId() },
		messages: [{ from: "user", content: "hello" }],
		locals: {},
	} as unknown as RunMcpFlowContext;
}

/** Drive the flow to completion, collecting what it yielded and what it returned. */
async function runFlow(overrides: Partial<Parameters<typeof runMcpFlow>[0]> = {}) {
	const updates: MessageUpdate[] = [];
	const generator = runMcpFlow({ ...context(), ...overrides } as Parameters<typeof runMcpFlow>[0]);
	let step = await generator.next();
	while (!step.done) {
		updates.push(step.value);
		step = await generator.next();
	}
	return { updates, result: step.value as McpFlowResult };
}

/** The messages sent on the nth upstream request (0-indexed). */
function requestMessages(n: number): ChatCompletionMessageParam[] {
	return mocks.create.mock.calls[n][0].messages;
}

function streamedText(updates: MessageUpdate[]) {
	return updates
		.filter((u) => u.type === MessageUpdateType.Stream)
		.map((u) => (u.type === MessageUpdateType.Stream ? u.token : ""))
		.join("");
}

function finalAnswer(updates: MessageUpdate[]) {
	const answer = updates.find((u) => u.type === MessageUpdateType.FinalAnswer);
	return answer?.type === MessageUpdateType.FinalAnswer ? answer.text : undefined;
}

beforeEach(() => {
	mocks.create.mockReset();
	mocks.executeToolCalls.mockReset();
	mocks.getAbortTime.mockReset();
	mocks.getAbortTime.mockReturnValue(undefined);
	scriptToolResults();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMcpFlow", () => {
	it("answers directly when the model calls no tools", async () => {
		scriptRounds([{ content: "the answer" }]);

		const { updates, result } = await runFlow();

		expect(result).toBe("completed");
		expect(streamedText(updates)).toBe("the answer");
		expect(finalAnswer(updates)).toBe("the answer");
		expect(mocks.executeToolCalls).not.toHaveBeenCalled();
	});

	it("runs a tool and feeds its result back for the follow-up answer", async () => {
		scriptRounds([
			{ toolCalls: [{ id: "call_1", name: "do_thing", arguments: '{"a":1}' }] },
			{ content: "done" },
		]);
		scriptToolResults("the tool output");

		const { result } = await runFlow();

		expect(result).toBe("completed");
		expect(mocks.executeToolCalls).toHaveBeenCalledTimes(1);
		// The call the model made has to reach the tool intact...
		expect(mocks.executeToolCalls.mock.calls[0][0].calls).toEqual([
			{ id: "call_1", name: "do_thing", arguments: '{"a":1}' },
		]);

		// ...and the follow-up has to carry the assistant's tool_calls *and* the matching
		// results. An assistant message without its tool_calls leaves the tool messages
		// orphaned, which providers reject outright.
		const followUp = requestMessages(1);
		expect(followUp.at(-2)).toMatchObject({
			role: "assistant",
			tool_calls: [
				{ id: "call_1", type: "function", function: { name: "do_thing", arguments: '{"a":1}' } },
			],
		});
		expect(followUp.at(-1)).toEqual({
			role: "tool",
			tool_call_id: "call_1",
			content: "the tool output",
		});
	});
});

describe("runMcpFlow truncated tool calls", () => {
	it("retries with an assistant turn when a tool-only round is cut off", async () => {
		scriptRounds([
			{
				toolCalls: [{ id: "call_1", name: "do_thing", arguments: '{"content":"import tor' }],
				finishReason: "length",
			},
			{ content: "smaller answer" },
		]);

		const { result } = await runFlow();

		expect(result).toBe("completed");
		expect(mocks.executeToolCalls).not.toHaveBeenCalled();

		// A tool-only round leaves no prose, so without a synthesized assistant turn the
		// nudge would be a second consecutive user message and strict providers 400.
		const retry = requestMessages(1);
		expect(retry.at(-2)?.role).toBe("assistant");
		// Empty content next to no tool_calls is itself rejected by some backends.
		expect(String(retry.at(-2)?.content ?? "")).not.toHaveLength(0);
		expect(retry.at(-1)?.role).toBe("user");
		expect(String(retry.at(-1)?.content)).toContain("output limit");
	});

	it("runs a complete tool call even when the round hit the output limit", async () => {
		scriptRounds([
			{
				toolCalls: [{ id: "call_1", name: "do_thing", arguments: '{"a":1}' }],
				finishReason: "length",
			},
			{ content: "done" },
		]);

		const { result } = await runFlow();

		expect(result).toBe("completed");
		expect(mocks.executeToolCalls).toHaveBeenCalledTimes(1);
		expect(mocks.executeToolCalls.mock.calls[0][0].calls).toEqual([
			{ id: "call_1", name: "do_thing", arguments: '{"a":1}' },
		]);
	});

	it("gives up and answers after repeated truncation instead of hanging on", async () => {
		const cutOff: Round = {
			toolCalls: [{ id: "call_1", name: "do_thing", arguments: '{"content":"import tor' }],
			finishReason: "length",
		};
		scriptRounds([cutOff, cutOff, cutOff]);

		const { updates, result } = await runFlow();

		expect(result).toBe("completed");
		expect(mocks.executeToolCalls).not.toHaveBeenCalled();
		expect(mocks.create).toHaveBeenCalledTimes(3);
		expect(finalAnswer(updates)).toContain("output limit");
	});
});

describe("runMcpFlow termination", () => {
	it("finalizes instead of reporting it never ran when the tool rounds run out", async () => {
		const toolRound: Round = {
			toolCalls: [{ id: "call_1", name: "do_thing", arguments: "{}" }],
		};
		scriptRounds(Array.from({ length: 10 }, () => toolRound));

		const { updates, result } = await runFlow();

		// "not_applicable" would make the caller re-run the turn with no tools and
		// discard all ten rounds of work.
		expect(result).toBe("exhausted");
		expect(mocks.create).toHaveBeenCalledTimes(10);
		expect(finalAnswer(updates)).toBeDefined();
	});

	it("falls back when it fails before showing anything", async () => {
		scriptRounds([{ error: new Error("upstream down") }]);

		const { result } = await runFlow();

		expect(result).toBe("not_applicable");
	});

	it("rethrows a failure that happens after output was streamed", async () => {
		scriptRounds([
			{ toolCalls: [{ id: "call_1", name: "do_thing", arguments: "{}" }] },
			{ error: new Error("upstream died mid-run") },
		]);

		await expect(runFlow()).rejects.toThrow("upstream died mid-run");
	});
});

describe("runMcpFlow in-loop reasoning echo", () => {
	/** The assistant turn carrying this round's tool_calls, as sent upstream. */
	function toolCallMessage(n: number) {
		return requestMessages(n).find(
			(m) => m.role === "assistant" && "tool_calls" in m && m.tool_calls
		) as (ChatCompletionMessageParam & { reasoning_content?: string }) | undefined;
	}

	const withReasoning = () => {
		scriptRounds([
			{
				reasoning: "I need the tool.",
				toolCalls: [{ id: "call_1", name: "do_thing", arguments: "{}" }],
			},
			{ content: "done" },
		]);
	};

	it("echoes the round's reasoning back by default", async () => {
		withReasoning();

		await runFlow();

		expect(toolCallMessage(1)?.reasoning_content).toBe("I need the tool.");
	});

	it("omits reasoning_content for a blocklisted model", async () => {
		// Not cosmetic: this family's provider rejects the field outright rather
		// than ignoring it —
		//   400 messages.2.assistant.reasoning_content: property ... is unsupported
		// — which would end the conversation mid-tool-loop. Emitting a trace and
		// accepting one back are different capabilities, and only the blocklist
		// knows the difference.
		withReasoning();

		await runFlow({
			model: { ...context().model, id: "google/gemma-4-31B-it", preservesReasoning: false },
		} as Partial<Parameters<typeof runMcpFlow>[0]>);

		const message = toolCallMessage(1);
		expect(message).toBeDefined();
		expect(message && "reasoning_content" in message).toBe(false);
	});

	it("honours a user override that turns reasoning on for a blocklisted model", async () => {
		withReasoning();

		await runFlow({
			reasoningOverride: true,
			model: { ...context().model, preservesReasoning: false },
		} as Partial<Parameters<typeof runMcpFlow>[0]>);

		expect(toolCallMessage(1)?.reasoning_content).toBe("I need the tool.");
	});

	it("honours a user override that turns reasoning off", async () => {
		withReasoning();

		await runFlow({ reasoningOverride: false } as Partial<Parameters<typeof runMcpFlow>[0]>);

		const message = toolCallMessage(1);
		expect(message && "reasoning_content" in message).toBe(false);
	});
});
