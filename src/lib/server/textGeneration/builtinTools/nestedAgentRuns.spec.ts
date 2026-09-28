import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { OpenAI } from "openai";
import { collections, ready } from "$lib/server/database";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("$lib/server/mcp/httpClient", () => ({
	callMcpTool: vi.fn(),
	getMcpToolTimeoutMs: () => 1_000,
}));
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: vi.fn(async () => ({})) }));
// no backoff, a rate limit ends the run at once
vi.mock("../utils/upstreamRetry", async (importOriginal) => ({
	...(await importOriginal<typeof import("../utils/upstreamRetry")>()),
	withUpstreamRetry: <T>(fn: () => Promise<T>) => fn(),
}));

const { callMcpTool } = await import("$lib/server/mcp/httpClient");
const { runNestedAgent } = await import("./nestedAgent");
const { createMlSourcesGuard } = await import("$lib/server/mlRegistry/sourcesGuard");
const { listMlSources } = await import("$lib/server/mlRegistry/sources");
const { AGENT_RUN_CALLS_MAX, AGENT_RUN_SUMMARY_MAX, AGENT_RUN_TASK_MAX } =
	await import("$lib/server/mlRegistry/agentRuns");
type NestedAgentDeps = import("./nestedAgent").NestedAgentDeps;
type NestedAgentSpec = import("./nestedAgent").NestedAgentSpec;
type BuiltinToolContext = import("./types").BuiltinToolContext;

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

beforeEach(() => {
	createCompletion.mockReset();
	vi.mocked(callMcpTool).mockReset();
});

afterEach(async () => {
	const filter = { conversationId: { $in: conversationIds } };
	await Promise.all([
		collections.mlAgentRuns.deleteMany(filter),
		collections.mlSources.deleteMany(filter),
		collections.nestedAgentCalls.deleteMany(filter),
	]);
	conversationIds.length = 0;
});

const createCompletion = vi.fn();
const openai = { chat: { completions: { create: createCompletion } } } as unknown as OpenAI;

const respond = (params: {
	content?: string | null;
	toolCalls?: { id: string; name: string; arguments: string }[];
	totalTokens?: number;
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
			finish_reason: params.toolCalls?.length ? "tool_calls" : "stop",
		},
	],
	usage: { total_tokens: params.totalTokens ?? 1_000 },
});

const HUB = { name: "Hugging Face", url: "https://hf.co/mcp?login" };
const PAPER_READ = JSON.stringify({
	operations: [{ cmd: "cat", args: ["hf://papers/2502.16161/paper.md"] }],
});

const makeSpec = (over: Partial<NestedAgentSpec> = {}): NestedAgentSpec => ({
	label: "research",
	displayName: "Research",
	toolName: "research",
	systemPrompt: "you are a research sub-agent",
	task: "Context: user builds X\n\nResearch task: find recipes",
	allowedTools: new Set(["hf_fs"]),
	maxIterations: 3,
	truncateOutput: (text) => text,
	stop: {
		contextWarn: "warn",
		contextMax: "stop now",
		iterationLimit: "summarise now",
		repetition: "repeating",
	},
	failure: {
		noTools: "No research tools are available.",
		contextMax: "Context exhausted.",
		iterationLimit: "Iteration limit, no summary.",
		noSummary: "No summary.",
		rateLimited: "Rate limited, call wait.",
	},
	progress: { start: "start", done: "done" },
	...over,
});

function setup({
	spec = {},
	deps = {},
	ctx = {},
}: {
	spec?: Partial<NestedAgentSpec>;
	deps?: Partial<NestedAgentDeps>;
	ctx?: Partial<BuiltinToolContext>;
} = {}) {
	const conversationId = new ObjectId();
	conversationIds.push(conversationId);
	const fullDeps: NestedAgentDeps = {
		openai,
		completionBase: { model: "test-model", stream: true },
		requestHeaders: {},
		servers: [HUB],
		mapping: { hf_fs: { fnName: "hf_fs", server: HUB.name, tool: "hf_fs" } },
		mcpTools: [{ type: "function", function: { name: "hf_fs", parameters: { type: "object" } } }],
		hostBuiltinTools: [],
		sourcesGuard: (readBy) => createMlSourcesGuard({ conversationId, readBy }),
		...deps,
	};
	const fullCtx: BuiltinToolContext = {
		uuid: "tool-uuid-1",
		toolCallId: "call-1",
		conversationId,
		messageId: "msg-1",
		generationId: "gen-1",
		...ctx,
	};
	return {
		conversationId,
		run: () => runNestedAgent(makeSpec(spec), fullCtx, fullDeps),
		rows: () => collections.mlAgentRuns.find({ conversationId }).toArray(),
	};
}

describe("a sub-agent run's row", () => {
	it("records a completed run with its parent, calls, summary and the sources it read", async () => {
		vi.mocked(callMcpTool).mockResolvedValue({
			text: "paper text",
			isError: false,
			structured: {
				results: [
					{
						index: 0,
						status: "success",
						result: { uri: "hf://papers/2502.16161/paper.md", content: "Title: OmniParser V2\n" },
					},
				],
			},
		});
		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }] })
			)
			.mockResolvedValueOnce(respond({ content: "the summary" }));
		const { conversationId, run, rows } = setup();

		expect(await run()).toEqual({ resultText: "the summary" });

		const [row, ...rest] = await rows();
		expect(rest).toEqual([]);
		expect(row).toMatchObject({
			label: "research",
			displayName: "Research",
			task: "Context: user builds X\n\nResearch task: find recipes",
			parent: {
				tool: "research",
				toolUuid: "tool-uuid-1",
				messageId: "msg-1",
				generationId: "gen-1",
			},
			status: "completed",
			summary: "the summary",
			iterations: 2,
			calls: [{ tool: "hf_fs", args: PAPER_READ, status: "success" }],
			callCount: 1,
			sourceCount: 1,
		});
		expect(row).not.toHaveProperty("failure");
		expect(row).not.toHaveProperty("forcedBy");
		expect(row.endedAt?.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());

		const [source] = await listMlSources(conversationId);
		expect(source).toMatchObject({
			url: "https://huggingface.co/papers/2502.16161",
			title: "OmniParser V2",
			readBy: [row._id.toString()],
		});
		await vi.waitFor(
			async () => {
				const logged = await collections.nestedAgentCalls.find({ conversationId }).toArray();
				expect(logged.map((call) => call.agentRunId)).toEqual([row._id.toString()]);
			},
			{ timeout: 10_000 }
		);
	});

	it("records a failed call and a refused one with their errors", async () => {
		vi.mocked(callMcpTool).mockResolvedValue({ text: "ENOENT", isError: true });
		createCompletion
			.mockResolvedValueOnce(
				respond({
					toolCalls: [
						{ id: "c1", name: "hf_fs", arguments: PAPER_READ },
						{ id: "c2", name: "hf_jobs", arguments: "{}" },
					],
				})
			)
			.mockResolvedValueOnce(respond({ content: "nothing found" }));
		const { run, rows } = setup();

		await run();

		const [row] = await rows();
		expect(row.calls).toEqual([
			{
				tool: "hf_fs",
				args: PAPER_READ,
				status: "error",
				error: expect.stringContaining("ENOENT"),
			},
			{
				tool: "hf_jobs",
				args: "{}",
				status: "error",
				error: "Tool 'hf_jobs' not available for research.",
			},
		]);
		expect(row.sourceCount).toBe(0);
	});

	it("records a run that had no tools to offer", async () => {
		const { run, rows } = setup({ deps: { mcpTools: [], mapping: {} } });

		expect(await run()).toEqual({ error: "No research tools are available." });

		const [row] = await rows();
		expect(row).toMatchObject({
			status: "failed",
			failure: "no_tools",
			error: "No research tools are available.",
			iterations: 0,
			calls: [],
		});
		expect(createCompletion).not.toHaveBeenCalled();
	});

	it("records a run that answered with no summary", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "" }));
		const { run, rows } = setup();
		await run();
		expect((await rows())[0]).toMatchObject({
			status: "failed",
			failure: "no_summary",
			error: "No summary.",
			iterations: 1,
		});
	});

	it("records an LLM failure and a rate limit as different failures", async () => {
		createCompletion.mockRejectedValueOnce(new Error("boom"));
		const first = setup();
		await first.run();
		expect((await first.rows())[0]).toMatchObject({
			status: "failed",
			failure: "llm_error",
			error: "Research agent LLM error: boom",
		});

		createCompletion.mockRejectedValueOnce(
			Object.assign(new Error('429 "Rate limit exceeded"'), { status: 429 })
		);
		const second = setup();
		await second.run();
		expect((await second.rows())[0]).toMatchObject({
			status: "failed",
			failure: "rate_limited",
			error: "Rate limited, call wait.",
		});
	});

	it("records an aborted run as aborted, not failed", async () => {
		const controller = new AbortController();
		controller.abort();
		const { run, rows } = setup({ ctx: { abortSignal: controller.signal } });

		expect(await run()).toEqual({ error: "Aborted by user" });

		const [row] = await rows();
		expect(row).toMatchObject({ status: "aborted", error: "Aborted by user" });
		expect(row).not.toHaveProperty("failure");
	});

	it("records a run aborted during its forced summary as aborted", async () => {
		const controller = new AbortController();
		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }] })
			)
			.mockImplementationOnce(async () => {
				controller.abort();
				throw new Error("Aborted by user");
			});
		vi.mocked(callMcpTool).mockResolvedValue({ text: "ok", isError: false });
		const { run, rows } = setup({
			spec: { maxIterations: 1 },
			ctx: { abortSignal: controller.signal },
		});

		await run();

		expect((await rows())[0]).toMatchObject({ status: "aborted" });
	});

	it("marks the summary a limit forced, and fails the run when the forced summary is empty", async () => {
		vi.mocked(callMcpTool).mockResolvedValue({ text: "ok", isError: false });
		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }] })
			)
			.mockResolvedValueOnce(respond({ content: "what I have" }));
		const forced = setup({ spec: { maxIterations: 1 } });
		expect(await forced.run()).toEqual({ resultText: "what I have" });
		expect((await forced.rows())[0]).toMatchObject({
			status: "completed",
			forcedBy: "iteration_limit",
			summary: "what I have",
			iterations: 1,
		});

		createCompletion
			.mockResolvedValueOnce(
				respond({ toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }] })
			)
			.mockResolvedValueOnce(respond({ content: "" }));
		const empty = setup({ spec: { maxIterations: 1 } });
		await empty.run();
		expect((await empty.rows())[0]).toMatchObject({
			status: "failed",
			failure: "iteration_limit",
			error: "Iteration limit, no summary.",
		});
	});

	it("marks a summary forced by the context limit", async () => {
		vi.mocked(callMcpTool).mockResolvedValue({ text: "ok", isError: false });
		createCompletion
			.mockResolvedValueOnce(
				respond({
					toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }],
					totalTokens: 1_000_000,
				})
			)
			.mockResolvedValueOnce(respond({ content: "wrapped up" }));
		const { run, rows } = setup({ deps: { contextLengthTokens: 10_000 } });

		await run();

		expect((await rows())[0]).toMatchObject({
			status: "completed",
			forcedBy: "context_limit",
			summary: "wrapped up",
			iterations: 1,
		});
	});

	it("records a throw out of the loop before passing it on", async () => {
		createCompletion.mockResolvedValueOnce(
			respond({ toolCalls: [{ id: "c1", name: "hf_fs", arguments: PAPER_READ }] })
		);
		const { run, rows } = setup({
			deps: {
				rewriteArgs: () => {
					throw new Error("rewrite exploded");
				},
			},
		});

		await expect(run()).rejects.toThrow("rewrite exploded");

		expect((await rows())[0]).toMatchObject({
			status: "failed",
			failure: "internal_error",
			error: "rewrite exploded",
			iterations: 1,
		});
	});

	it("caps the task, the summary, each call and the call list, and redacts secrets", async () => {
		const secret = "hf_abcdefghijklmnopqrstuvwxyz0123";
		const refused = Array.from({ length: AGENT_RUN_CALLS_MAX + 5 }, (_, i) => ({
			id: `r${i}`,
			name: "hf_jobs",
			arguments: JSON.stringify({ token: secret, pad: "x".repeat(400), i }),
		}));
		createCompletion
			.mockResolvedValueOnce(respond({ toolCalls: refused }))
			.mockResolvedValueOnce(respond({ content: "s".repeat(AGENT_RUN_SUMMARY_MAX + 100) }));
		const task = `Context: ${"c".repeat(AGENT_RUN_TASK_MAX)}\n\nResearch task: find recipes`;
		const { run, rows } = setup({ spec: { task } });

		await run();

		const [row] = await rows();
		expect(row.task.length).toBeLessThanOrEqual(AGENT_RUN_TASK_MAX + 3);
		expect(row.task.startsWith("Context: ")).toBe(true);
		expect(row.task.endsWith("Research task: find recipes")).toBe(true);
		expect(row.summary).toHaveLength(AGENT_RUN_SUMMARY_MAX + 1);
		expect(row.calls).toHaveLength(AGENT_RUN_CALLS_MAX);
		expect(row.callCount).toBe(AGENT_RUN_CALLS_MAX + 5);
		expect(row.calls[0].args.length).toBeLessThanOrEqual(201);
		expect(JSON.stringify(row.calls)).not.toContain(secret);
		expect(row.calls[0].args).toContain("<redacted>");
	});

	it("leaves no row for a run with no conversation behind it", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "the summary" }));
		const { run } = setup({ ctx: { conversationId: undefined } });

		expect(await run()).toEqual({ resultText: "the summary" });
		expect(
			await collections.mlAgentRuns.countDocuments({ label: "research", task: /find recipes/ })
		).toBe(0);
	});

	it("never fails the run when the database does", async () => {
		vi.spyOn(collections.mlAgentRuns, "insertOne").mockRejectedValueOnce(new Error("db down"));
		createCompletion.mockResolvedValueOnce(respond({ content: "the summary" }));
		const { run } = setup();

		expect(await run()).toEqual({ resultText: "the summary" });
		vi.restoreAllMocks();
	});
});
