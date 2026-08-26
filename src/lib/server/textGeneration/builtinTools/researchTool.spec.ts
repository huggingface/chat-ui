import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAI } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: vi.fn(),
	getMcpToolTimeoutMs: () => 1_000,
}));
vi.mock("$lib/server/mcp/clientPool", () => ({
	getClient: vi.fn(async () => ({})),
}));

const {
	createResearchTool,
	isResearchTool,
	truncateResearchToolOutput,
	MAX_RESEARCH_ITERATIONS,
	RESEARCH_TOOL_NAME,
} = await import("./researchTool");
const { RESEARCH_CONTEXT_MAX_PROMPT, RESEARCH_CONTEXT_WARN_PROMPT, RESEARCH_REPETITION_PROMPT } =
	await import("./researchPrompt");
type ResearchRuntimeDeps = import("./researchTool").ResearchRuntimeDeps;
type BuiltinTool = import("./types").BuiltinTool;

const createCompletion = vi.fn();
const openai = {
	chat: { completions: { create: createCompletion } },
} as unknown as OpenAI;

/** A non-stream chat completion response. */
const respond = (params: {
	content?: string | null;
	toolCalls?: { id: string; name: string; arguments: string }[];
	totalTokens?: number;
	finishReason?: string;
}) => ({
	choices: [
		{
			message: {
				content: params.content ?? null,
				tool_calls: params.toolCalls?.map((call) => ({
					id: call.id,
					type: "function" as const,
					function: { name: call.name, arguments: call.arguments },
				})),
			},
			finish_reason: params.finishReason ?? (params.toolCalls?.length ? "tool_calls" : "stop"),
		},
	],
	usage: { total_tokens: params.totalTokens ?? 1_000 },
});

const hfFsExecute = vi.fn(async () => ({ resultText: "search results" }));
const fakeHfFs: BuiltinTool = {
	name: "hf_fs",
	definition: { type: "function", function: { name: "hf_fs", parameters: { type: "object" } } },
	execute: hfFsExecute,
};

const makeDeps = (over: Partial<ResearchRuntimeDeps> = {}): ResearchRuntimeDeps => ({
	openai,
	completionBase: {
		model: "test-model",
		stream: true,
		tools: [],
		tool_choice: "auto",
		reasoning_effort: "high",
	},
	requestHeaders: { "ChatUI-Conversation-ID": "conv-1" },
	servers: [],
	mapping: {},
	mcpTools: [],
	hostBuiltinTools: [fakeHfFs],
	...over,
});

const ctx = { uuid: "u1", toolCallId: "c1" };

const boundTool = (over: Partial<ResearchRuntimeDeps> = {}) => {
	const tool = createResearchTool();
	tool.bind(makeDeps(over));
	return tool;
};

/** Messages of the nth request made to the mocked client. */
const requestMessages = (n: number) =>
	(createCompletion.mock.calls[n][0] as { messages: ChatCompletionMessageParam[] }).messages;

beforeEach(() => {
	createCompletion.mockReset();
	hfFsExecute.mockClear();
	hfFsExecute.mockResolvedValue({ resultText: "search results" });
});

describe("createResearchTool", () => {
	it("is recognized by the type guard; other builtins are not", () => {
		expect(isResearchTool(createResearchTool())).toBe(true);
		expect(isResearchTool(fakeHfFs)).toBe(false);
	});

	it("errors before bind instead of dereferencing missing deps", async () => {
		const outcome = await createResearchTool().execute({ task: "t" }, ctx);
		expect("error" in outcome && outcome.error).toContain("not initialized");
	});

	it("requires a task and at least one available research tool", async () => {
		expect(await boundTool().execute({}, ctx)).toEqual({ error: "No research task provided." });
		expect(await boundTool({ hostBuiltinTools: [] }).execute({ task: "t" }, ctx)).toEqual({
			error: "No research tools are available in this deployment.",
		});
	});
});

describe("the nested loop", () => {
	it("runs on a fresh two-message context and returns the first no-tools response", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "the summary" }));

		const outcome = await boundTool().execute(
			{ task: "find recipes", context: "user builds X" },
			ctx
		);

		expect(outcome).toEqual({ resultText: "the summary" });
		expect(createCompletion).toHaveBeenCalledTimes(1);
		const request = createCompletion.mock.calls[0][0];
		expect(request.stream).toBe(false);
		expect(request.model).toBe("test-model");
		// Only the allowlisted defs are offered — never the parent's tool set.
		expect(request.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
			"hf_fs",
		]);
		expect(request.messages).toEqual([
			{ role: "system", content: expect.stringContaining("research sub-agent") },
			{ role: "user", content: "Context: user builds X\n\nResearch task: find recipes" },
		]);
	});

	it("executes an allowlisted call, feeds the result back, and truncates long outputs", async () => {
		hfFsExecute.mockResolvedValueOnce({ resultText: "x".repeat(10_000) });
		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "t1", name: "hf_fs", arguments: '{"q":"a"}' }] })
			)
			.mockResolvedValueOnce(respond({ content: "done" }));

		const outcome = await boundTool().execute({ task: "t" }, ctx);

		expect(outcome).toEqual({ resultText: "done" });
		expect(hfFsExecute).toHaveBeenCalledTimes(1);
		const toolMessage = requestMessages(1).find((m) => m.role === "tool") as {
			content: string;
			tool_call_id: string;
		};
		expect(toolMessage.tool_call_id).toBe("t1");
		expect(toolMessage.content).toContain("...(truncated)...");
		expect(toolMessage.content.length).toBe(4800 + 3200 + "\n...(truncated)...\n".length);
	});

	it("refuses tools outside the allowlist without executing anything", async () => {
		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "t1", name: "hf_jobs", arguments: "{}" }] })
			)
			.mockResolvedValueOnce(respond({ content: "done" }));

		await boundTool().execute({ task: "t" }, ctx);

		expect(hfFsExecute).not.toHaveBeenCalled();
		expect(requestMessages(1)).toContainEqual({
			role: "tool",
			tool_call_id: "t1",
			content: "Tool 'hf_jobs' not available for research.",
		});
	});

	it("forces the summary at the iteration limit by dropping tools from the request", async () => {
		createCompletion.mockImplementation(async (request: { tools?: unknown }) =>
			request.tools
				? respond({ toolCalls: [{ id: "t", name: "hf_fs", arguments: `{"i":${Math.random()}}` }] })
				: respond({ content: "salvaged summary" })
		);

		const outcome = await boundTool().execute({ task: "t" }, ctx);

		expect(outcome).toEqual({ resultText: "salvaged summary" });
		expect(createCompletion).toHaveBeenCalledTimes(MAX_RESEARCH_ITERATIONS + 1);
		const finalRequest = createCompletion.mock.calls[MAX_RESEARCH_ITERATIONS][0];
		expect(finalRequest.tools).toBeUndefined();
		const finalMessages = finalRequest.messages as ChatCompletionMessageParam[];
		expect(finalMessages[finalMessages.length - 1].content).toContain("[SYSTEM: ITERATION LIMIT]");
	});

	it("nudges at 85% of context and hard-stops at 95% with a tool-less request", async () => {
		createCompletion
			.mockResolvedValueOnce(
				respond({
					toolCalls: [{ id: "t1", name: "hf_fs", arguments: '{"q":"a"}' }],
					totalTokens: 90, // ≥ 85% of 100
				})
			)
			.mockResolvedValueOnce(
				respond({
					toolCalls: [{ id: "t2", name: "hf_fs", arguments: '{"q":"b"}' }],
					totalTokens: 96, // ≥ 95% of 100
				})
			)
			.mockResolvedValueOnce(respond({ content: "budget summary" }));

		const outcome = await boundTool({ contextLengthTokens: 100 }).execute({ task: "t" }, ctx);

		expect(outcome).toEqual({ resultText: "budget summary" });
		// Second request carries the soft nudge…
		expect(requestMessages(1).map((m) => m.content)).toContain(RESEARCH_CONTEXT_WARN_PROMPT);
		// …and the third is the forced summary: hard-stop message, no tools.
		const finalRequest = createCompletion.mock.calls[2][0];
		expect(finalRequest.tools).toBeUndefined();
		expect((finalRequest.messages as ChatCompletionMessageParam[]).at(-1)?.content).toBe(
			RESEARCH_CONTEXT_MAX_PROMPT
		);
	});

	it("injects the repetition nudge once when the same call repeats three times", async () => {
		let round = 0;
		createCompletion.mockImplementation(async (request: { tools?: unknown }) => {
			if (!request.tools) return respond({ content: "s" });
			round += 1;
			return round <= 4
				? respond({ toolCalls: [{ id: `t${round}`, name: "hf_fs", arguments: '{"q":"same"}' }] })
				: respond({ content: "recovered" });
		});

		const outcome = await boundTool().execute({ task: "t" }, ctx);

		expect(outcome).toEqual({ resultText: "recovered" });
		const nudges = requestMessages(4).filter((m) => m.content === RESEARCH_REPETITION_PROMPT);
		expect(nudges).toHaveLength(1);
	});

	it("nudges instead of returning a summary that was cut by the output limit", async () => {
		createCompletion
			.mockResolvedValueOnce(respond({ content: "half a thou", finishReason: "length" }))
			.mockResolvedValueOnce(respond({ content: "full summary" }));

		const outcome = await boundTool().execute({ task: "t" }, ctx);

		expect(outcome).toEqual({ resultText: "full summary" });
		const retry = requestMessages(1);
		expect(retry.at(-2)?.role).toBe("assistant");
		expect(String(retry.at(-1)?.content)).toContain("output limit");
	});

	it("absorbs a transient 429 with backoff instead of discarding the run", async () => {
		vi.useFakeTimers();
		try {
			const rateLimit = Object.assign(new Error('429 "Rate limit exceeded"'), { status: 429 });
			createCompletion
				.mockRejectedValueOnce(rateLimit)
				.mockResolvedValueOnce(respond({ content: "recovered summary" }));

			const pending = boundTool().execute({ task: "t" }, ctx);
			await vi.advanceTimersByTimeAsync(10_000);
			expect(await pending).toEqual({ resultText: "recovered summary" });
			expect(createCompletion).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("tells the model to wait and re-call when rate-limit retries run out", async () => {
		vi.useFakeTimers();
		try {
			createCompletion.mockRejectedValue(
				Object.assign(new Error('429 "Rate limit exceeded"'), { status: 429 })
			);

			const pending = boundTool().execute({ task: "t" }, ctx);
			await vi.advanceTimersByTimeAsync(10_000 + 25_000 + 60_000);
			const outcome = await pending;
			expect("error" in outcome && outcome.error).toContain("Call wait");
			// The initial call plus one per backoff step.
			expect(createCompletion).toHaveBeenCalledTimes(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports an aborted run as an error and surfaces LLM failures", async () => {
		const aborted = new AbortController();
		aborted.abort();
		expect(
			await boundTool().execute({ task: "t" }, { ...ctx, abortSignal: aborted.signal })
		).toEqual({ error: "Aborted by user" });

		createCompletion.mockRejectedValueOnce(new Error("boom"));
		expect(await boundTool().execute({ task: "t" }, ctx)).toEqual({
			error: "Research agent LLM error: boom",
		});
	});
});

describe("truncateResearchToolOutput", () => {
	it("keeps short outputs intact and head/tails long ones", () => {
		expect(truncateResearchToolOutput("short")).toBe("short");
		const long = "a".repeat(5000) + "b".repeat(5000);
		const truncated = truncateResearchToolOutput(long);
		expect(truncated.startsWith("a".repeat(4800))).toBe(true);
		expect(truncated.endsWith("b".repeat(3200))).toBe(true);
		expect(truncated).toContain("...(truncated)...");
	});

	it("never leaves a lone surrogate at a slice boundary", () => {
		// 😀 is a surrogate pair; place one so the head slice cuts it in half, and
		// another so the tail slice starts on its low half. One lone surrogate
		// in a message 400s every request that carries it, permanently.
		const headSplit = "a".repeat(4799) + "😀" + "b".repeat(5000);
		const tailSplit = "x".repeat(5000) + "😀" + "y".repeat(3199);
		for (const input of [headSplit, tailSplit]) {
			const truncated = truncateResearchToolOutput(input);
			expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
			expect(truncated).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
			// Sanity: it still round-trips through strict JSON.
			expect(() => JSON.parse(JSON.stringify(truncated))).not.toThrow();
		}
	});
});

describe("the tool definition", () => {
	it("names itself research and requires a task", () => {
		const tool = createResearchTool();
		expect(tool.name).toBe(RESEARCH_TOOL_NAME);
		expect(tool.exemptFromToolRestraint).toBe(true);
		expect(tool.definition.function.parameters).toMatchObject({ required: ["task"] });
	});
});
