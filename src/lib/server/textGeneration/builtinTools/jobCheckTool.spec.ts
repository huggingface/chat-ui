import { describe, expect, it } from "vitest";
import {
	JOB_CHECK_TOOL_NAME,
	MAX_JOB_CHECK_ITERATIONS,
	createJobCheckTool,
	isJobCheckTool,
	truncateJobCheckOutput,
} from "./jobCheckTool";
import { JOB_CHECK_DELEGATION_DOCTRINE, JOB_CHECK_SYSTEM_PROMPT } from "./jobCheckPrompt";

const tool = createJobCheckTool();

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
