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
vi.mock("$lib/server/mcp/clientPool", () => ({ getClient: vi.fn(async () => ({})) }));

const {
	createSandboxTool,
	isSandboxTool,
	truncateSandboxToolOutput,
	MAX_SANDBOX_ITERATIONS,
	SANDBOX_TOOL_NAME,
} = await import("./sandboxTool");
const { createResearchTool } = await import("./researchTool");
type NestedAgentDeps = import("./nestedAgent").NestedAgentDeps;
type OpenAiTool = import("$lib/server/mcp/tools").OpenAiTool;

const createCompletion = vi.fn();
const openai = { chat: { completions: { create: createCompletion } } } as unknown as OpenAI;

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

const mcpTool = (name: string): OpenAiTool => ({
	type: "function",
	function: { name, parameters: { type: "object" } },
});

const SANDBOX_MCP_TOOLS = [
	mcpTool("hf_sandbox_exec"),
	mcpTool("hf_sandbox_fs"),
	// Present in the turn but never allowlisted: creating and submitting cost money.
	mcpTool("hf_sandbox"),
	mcpTool("hf_jobs"),
	mcpTool("hf_fs_write"),
];

const HUB = { name: "Hugging Face", url: "https://hf.co/mcp?login" };
/** Every advertised tool, mapped to whichever server exported it. */
const mappingFor = (server: { name: string }, ...tools: string[]) =>
	Object.fromEntries(
		tools.map((tool) => [tool, { fnName: tool, server: server.name, tool }])
	) as NestedAgentDeps["mapping"];

const makeDeps = (over: Partial<NestedAgentDeps> = {}): NestedAgentDeps => ({
	openai,
	completionBase: { model: "test-model", stream: true, tools: [], tool_choice: "auto" },
	requestHeaders: { "ChatUI-Conversation-ID": "conv-1" },
	servers: [HUB],
	mapping: mappingFor(
		HUB,
		"hf_sandbox_exec",
		"hf_sandbox_fs",
		"hf_sandbox",
		"hf_jobs",
		"hf_fs_write"
	),
	mcpTools: SANDBOX_MCP_TOOLS,
	hostBuiltinTools: [],
	...over,
});

const ctx = { uuid: "u1", toolCallId: "c1" };
const HANDLE = "hfsb2:pngwn:6a99a386e686246ca699f46f";

const boundTool = (over: Partial<NestedAgentDeps> = {}) => {
	const tool = createSandboxTool();
	tool.bind(makeDeps(over));
	return tool;
};
const request = (n: number) =>
	createCompletion.mock.calls[n][0] as {
		messages: ChatCompletionMessageParam[];
		tools?: OpenAiTool[];
	};

beforeEach(() => createCompletion.mockReset());

describe("createSandboxTool", () => {
	it("is recognized by the type guard; the research sub-agent is not", () => {
		expect(isSandboxTool(createSandboxTool())).toBe(true);
		expect(isSandboxTool(createResearchTool())).toBe(false);
	});

	it("requires a handle and a task before it does anything", async () => {
		const tool = boundTool();

		expect(await tool.execute({ task: "make it run" }, ctx)).toEqual({
			error: "No sandbox handle provided.",
		});
		expect(await tool.execute({ handle: HANDLE }, ctx)).toEqual({
			error: "No sandbox task provided.",
		});
		expect(createCompletion).not.toHaveBeenCalled();
	});

	it("errors before bind instead of dereferencing missing deps", async () => {
		const outcome = await createSandboxTool().execute({ handle: HANDLE, task: "run it" }, ctx);
		expect("error" in outcome && outcome.error).toContain("not initialized");
	});

	it("tells the caller to do it themselves where no sandbox tools exist", async () => {
		const tool = boundTool({ mcpTools: [mcpTool("hf_fs")], mapping: mappingFor(HUB, "hf_fs") });

		const outcome = await tool.execute({ handle: HANDLE, task: "run it" }, ctx);

		expect("error" in outcome && outcome.error).toContain("Run the commands yourself");
		expect(createCompletion).not.toHaveBeenCalled();
	});
});

describe("the sandbox sub-agent's boundary", () => {
	it("offers exec and file access and nothing that spends or creates", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "Outcome: worked." }));

		await boundTool().execute({ handle: HANDLE, task: "run it" }, ctx);

		// A sub-agent's calls bypass the parent's budget gate, so anything that
		// could reserve compute has to be absent from the request itself.
		expect(request(0).tools?.map((t) => t.function.name)).toEqual([
			"hf_sandbox_exec",
			"hf_sandbox_fs",
		]);
	});

	it("starts from a fresh context carrying the handle, context and task", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "Outcome: worked." }));

		await boundTool().execute(
			{ handle: HANDLE, task: "make train.py import", context: "torch is pinned to 2.4" },
			ctx
		);

		const messages = request(0).messages;
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("system");
		const seeded = String(messages[1].content);
		expect(seeded).toContain(HANDLE);
		expect(seeded).toContain("torch is pinned to 2.4");
		expect(seeded).toContain("make train.py import");
	});

	it("returns only the sub-agent's summary, never its command output", async () => {
		createCompletion
			.mockResolvedValueOnce(
				respond({
					toolCalls: [
						{ id: "t1", name: "hf_sandbox_exec", arguments: '{"cmd":"exec","args":["exec"]}' },
					],
				})
			)
			.mockResolvedValueOnce(respond({ content: "Outcome: worked. Files: /data/train.py" }));

		const outcome = await boundTool().execute({ handle: HANDLE, task: "run it" }, ctx);

		expect(outcome).toEqual({ resultText: "Outcome: worked. Files: /data/train.py" });
	});

	it("refuses a tool outside the allowlist without executing it", async () => {
		createCompletion
			.mockResolvedValueOnce(
				respond({
					toolCalls: [{ id: "t1", name: "hf_jobs", arguments: '{"operation":"uv"}' }],
				})
			)
			.mockResolvedValueOnce(respond({ content: "Outcome: did not work." }));

		await boundTool().execute({ handle: HANDLE, task: "train it" }, ctx);

		const refusal = request(1).messages.at(-1);
		expect(refusal?.role).toBe("tool");
		expect(String(refusal?.content)).toContain("not available for sandbox");
	});

	it("drops tools from the request to force a report at the iteration limit", async () => {
		for (let i = 0; i < MAX_SANDBOX_ITERATIONS; i += 1) {
			createCompletion.mockResolvedValueOnce(
				respond({
					toolCalls: [
						{ id: `t${i}`, name: "hf_sandbox_exec", arguments: `{"cmd":"exec","args":["${i}"]}` },
					],
				})
			);
		}
		createCompletion.mockResolvedValueOnce(respond({ content: "Outcome: did not work." }));

		const outcome = await boundTool().execute({ handle: HANDLE, task: "run it" }, ctx);

		const forced = request(MAX_SANDBOX_ITERATIONS);
		expect(forced.tools).toBeUndefined();
		expect(String(forced.messages.at(-1)?.content)).toContain("[SYSTEM: ITERATION LIMIT]");
		expect(outcome).toEqual({ resultText: "Outcome: did not work." });
	});

	it("says the task was too broad when even the forced report is empty", async () => {
		// Every iteration calls a tool, so the loop runs out; the forced summary
		// then comes back with no content at all.
		createCompletion.mockResolvedValue(
			respond({ toolCalls: [{ id: "t", name: "hf_sandbox_exec", arguments: '{"cmd":"exec"}' }] })
		);

		const outcome = await boundTool().execute({ handle: HANDLE, task: "do everything" }, ctx);

		expect("error" in outcome && outcome.error).toContain("too broad");
	});
});

describe("truncateSandboxToolOutput", () => {
	it("keeps short output whole", () => {
		expect(truncateSandboxToolOutput("exit 0")).toBe("exit 0");
	});

	it("keeps more of the tail than the head, where the traceback is", () => {
		const output = "H".repeat(4_000) + "T".repeat(4_000);

		const truncated = truncateSandboxToolOutput(output);

		expect(truncated).toContain("...(truncated)...");
		const [head, tail] = truncated.split("\n...(truncated)...\n");
		expect(tail.length).toBeGreaterThan(head.length);
		expect(tail.endsWith("T")).toBe(true);
	});
});

describe("the tool definition", () => {
	it("requires the handle the parent already created", () => {
		const { function: fn } = createSandboxTool().definition;
		const params = fn.parameters as { required: string[]; properties: Record<string, unknown> };

		expect(fn.name).toBe(SANDBOX_TOOL_NAME);
		expect(params.required).toEqual(["handle", "task"]);
		expect(Object.keys(params.properties)).toEqual(["handle", "task", "context"]);
	});

	it("tells the parent what it keeps", () => {
		const doctrine = createSandboxTool().preprompt ?? "";

		expect(doctrine).toContain("creating and terminating the sandbox");
		expect(doctrine).toContain("submitting jobs");
	});
});

describe("where the sandbox tools are allowed to come from", () => {
	const OTHER = { name: "Someone else", url: "https://other.test/mcp" };

	it("refuses a same-named tool exported by a server that is not the Hub", async () => {
		// A name only gets a collision suffix when two servers offer it at once,
		// so if the Hub's listing omits the sandbox tools a custom server's
		// `hf_sandbox_exec` inherits the bare name. Handing it the handle would
		// send a Hub sandbox id and the task to an unrelated server, outside the
		// parent's guard chain.
		const tool = boundTool({
			servers: [OTHER],
			mapping: mappingFor(OTHER, "hf_sandbox_exec", "hf_sandbox_fs"),
		});

		const outcome = await tool.execute({ handle: HANDLE, task: "run it" }, ctx);

		expect("error" in outcome && outcome.error).toContain("Run the commands yourself");
		expect(createCompletion).not.toHaveBeenCalled();
	});

	it("takes the Hub's own tools and leaves an impostor out of the same run", async () => {
		createCompletion.mockResolvedValueOnce(respond({ content: "Outcome: worked." }));
		const tool = boundTool({
			servers: [HUB, OTHER],
			mapping: {
				...mappingFor(HUB, "hf_sandbox_exec"),
				...mappingFor(OTHER, "hf_sandbox_fs"),
			},
		});

		await tool.execute({ handle: HANDLE, task: "run it" }, ctx);

		expect(request(0).tools?.map((t) => t.function.name)).toEqual(["hf_sandbox_exec"]);
	});

	it("refuses a tool whose server is not in this turn's list at all", async () => {
		const tool = boundTool({ servers: [], mapping: mappingFor(HUB, "hf_sandbox_exec") });

		const outcome = await tool.execute({ handle: HANDLE, task: "run it" }, ctx);

		expect("error" in outcome && outcome.error).toContain("Run the commands yourself");
	});
});
