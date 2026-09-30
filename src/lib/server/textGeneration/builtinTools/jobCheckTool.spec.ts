import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import {
	JOB_CHECK_TOOL_NAME,
	MAX_JOB_CHECK_ITERATIONS,
	createJobCheckTool,
	isJobCheckTool,
	truncateJobCheckOutput,
} from "./jobCheckTool";
import {
	JOB_CHECK_DELEGATION_DOCTRINE,
	JOB_CHECK_SYSTEM_PROMPT,
	jobCheckSystemPrompt,
} from "./jobCheckPrompt";
import type { NestedAgentDeps } from "./nestedAgent";
import type { BuiltinTool } from "./types";
import type { OpenAiTool } from "$lib/server/mcp/tools";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const tool = createJobCheckTool();

const HUB = { name: "Hugging Face", url: "https://hf.co/mcp?login" };
const mcpTool = (name: string): OpenAiTool => ({
	type: "function",
	function: { name, parameters: { type: "object" } },
});
const builtin = (name: string): BuiltinTool => ({
	name,
	definition: mcpTool(name),
	execute: vi.fn(async () => ({ resultText: "" })),
});
const createCompletion = vi.fn();
const makeDeps = (over: Partial<NestedAgentDeps> = {}): NestedAgentDeps => ({
	openai: { chat: { completions: { create: createCompletion } } } as unknown as OpenAI,
	completionBase: { model: "test-model", stream: true, tools: [], tool_choice: "auto" },
	requestHeaders: {},
	servers: [HUB],
	mapping: Object.fromEntries(
		["hf_jobs", "hf_fs_write"].map((name) => [name, { fnName: name, server: HUB.name, tool: name }])
	),
	mcpTools: [mcpTool("hf_jobs"), mcpTool("hf_fs_write")],
	hostBuiltinTools: [],
	...over,
});

describe("the job check's boundary", () => {
	it("holds hf_jobs and nothing else", () => {
		const params = tool.definition.function.parameters as { required?: string[] };

		expect(tool.name).toBe(JOB_CHECK_TOOL_NAME);
		expect(params.required).toEqual(["job_id", "task"]);
		expect(tool.definition.function.description).toContain("cannot submit, cancel or reschedule");
	});

	it("is recognised as a nested-agent tool so runMcpFlow binds it", () => {
		expect(isJobCheckTool(tool)).toBe(true);
		expect("bind" in tool).toBe(true);
	});

	it("refuses a call with no job id", async () => {
		const result = await tool.execute({ task: "check it survived step 1" }, {} as never);

		expect(result).toEqual({ error: "No job id provided." });
	});

	it("refuses a check with no question", async () => {
		const result = await tool.execute({ job_id: "abc123" }, {} as never);

		expect(result).toEqual({ error: "No check task provided." });
	});

	it("reports an unbound run as uninitialized rather than throwing", async () => {
		const result = await tool.execute({ job_id: "abc123", task: "watch it" }, {} as never);

		expect(result).toEqual({ error: "Job check tool not initialized for this request." });
	});
});

describe("the checker and the virtual files", () => {
	it("offers read_file beside hf_jobs and nothing that writes", async () => {
		createCompletion.mockReset();
		createCompletion.mockResolvedValueOnce({
			choices: [{ message: { content: "Status: running" }, finish_reason: "stop" }],
			usage: { total_tokens: 10 },
		});
		const bound = createJobCheckTool();
		bound.bind(
			makeDeps({
				hostBuiltinTools: ["write_file", "edit_file", "read_file", "import_file"].map(builtin),
			})
		);

		const outcome = await bound.execute(
			{ job_id: "abc123", task: "did it start" },
			{ uuid: "u1", toolCallId: "c1" }
		);

		expect(outcome).toEqual({ resultText: "Status: running" });
		const request = createCompletion.mock.calls[0][0] as { tools?: OpenAiTool[] };
		expect(request.tools?.map((t) => t.function.name)).toEqual(["read_file", "hf_jobs"]);
	});

	it("tells it to open the script version the job ran at the traceback's line", () => {
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("You also have read_file");
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("v-file://train.py@v4");
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("Read the region, not the file");
	});

	it("names no file tool to a run without them", () => {
		const off = jobCheckSystemPrompt({ virtualFiles: false });
		expect(off).toContain("You have one tool, hf_jobs");
		expect(off).not.toContain("read_file");
		expect(off).not.toContain("v-file://");
		expect(createJobCheckTool({ virtualFiles: false }).preprompt).not.toContain("v-file://");
	});

	it("tells the parent to pass the version the job ran", () => {
		expect(JOB_CHECK_DELEGATION_DOCTRINE(JOB_CHECK_TOOL_NAME)).toContain(
			"Put the script version the job ran in its context"
		);
	});
});

describe("what the checker is told", () => {
	it("says it may only read, in the prompt as well as the schema", () => {
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("you may only read");
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("cannot submit a job");
	});

	it("tells it that it cannot wait, because wait parks the whole turn", () => {
		// A sub-agent runs inside one parent tool call, so the `wait` builtin cannot
		// reach it. Unsaid, the prompt asks for a watch it has no way to perform.
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("You also cannot wait");
		expect(JOB_CHECK_SYSTEM_PROMPT).toContain("The caller does the waiting");
	});

	it("leaves the waiting with the parent, explicitly", () => {
		const doctrine = JOB_CHECK_DELEGATION_DOCTRINE(JOB_CHECK_TOOL_NAME);

		expect(doctrine).toContain("The waiting stays with you");
		expect(doctrine).toContain("call wait for the delay");
	});

	it("tells the parent this covers the smoke job too", () => {
		const doctrine = JOB_CHECK_DELEGATION_DOCTRINE(JOB_CHECK_TOOL_NAME);

		expect(doctrine).toContain("smoke job");
		expect(doctrine).toContain("Submitting and cancelling stay with you");
	});

	it("caps low enough that it cannot tight-poll instead of reporting", () => {
		expect(MAX_JOB_CHECK_ITERATIONS).toBeLessThanOrEqual(8);
	});
});

describe("truncateJobCheckOutput", () => {
	it("keeps the end, where the traceback and exit status are", () => {
		const log = `${"progress bar line\n".repeat(2000)}Traceback: CUDA out of memory\nEXIT=1`;

		const out = truncateJobCheckOutput(log);

		expect(out.length).toBeLessThan(log.length);
		expect(out).toContain("CUDA out of memory");
		expect(out).toContain("EXIT=1");
	});

	it("leaves a short log alone", () => {
		expect(truncateJobCheckOutput("step 1 loss 2.3")).toBe("step 1 loss 2.3");
	});
});
