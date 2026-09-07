import { describe, expect, it } from "vitest";
import {
	JOB_WATCHER_TOOL_NAME,
	MAX_JOB_WATCHER_ITERATIONS,
	createJobWatcherTool,
	isJobWatcherTool,
	truncateJobWatcherOutput,
} from "./jobWatcherTool";
import { JOB_WATCHER_DELEGATION_DOCTRINE, JOB_WATCHER_SYSTEM_PROMPT } from "./jobWatcherPrompt";

const tool = createJobWatcherTool();

describe("the job watcher's boundary", () => {
	it("holds hf_jobs and nothing else", () => {
		// It exists to take an hour of polling out of the parent's context, not to
		// gain any new power: submitting stays where the budget gate and the
		// pre-flight list the user sees are.
		const params = tool.definition.function.parameters as { required?: string[] };

		expect(tool.name).toBe(JOB_WATCHER_TOOL_NAME);
		expect(params.required).toEqual(["job_id", "task"]);
		expect(tool.definition.function.description).toContain("cannot submit, cancel or reschedule");
	});

	it("is recognised as a nested-agent tool so runMcpFlow binds it", () => {
		// A sub-agent whose deps are never bound fails at call time with
		// "not initialized", which reads like a deployment problem and is not.
		expect(isJobWatcherTool(tool)).toBe(true);
		expect("bind" in tool).toBe(true);
	});

	it("refuses a call with no job id rather than watching nothing", async () => {
		const result = await tool.execute({ task: "check it survived step 1" }, {} as never);

		expect(result).toEqual({ error: "No job id provided." });
	});

	it("refuses a watch with no question", async () => {
		const result = await tool.execute({ job_id: "abc123" }, {} as never);

		expect(result).toEqual({ error: "No watch task provided." });
	});

	it("reports an unbound run as uninitialized rather than throwing", async () => {
		const result = await tool.execute({ job_id: "abc123", task: "watch it" }, {} as never);

		expect(result).toEqual({ error: "Job watcher tool not initialized for this request." });
	});
});

describe("what the watcher is told", () => {
	it("says it may only read, in the prompt as well as the schema", () => {
		expect(JOB_WATCHER_SYSTEM_PROMPT).toContain("you may only read");
		expect(JOB_WATCHER_SYSTEM_PROMPT).toContain("cannot submit a job");
	});

	it("tells it not to spend iterations waiting", () => {
		// The failure this agent must not repeat: the sandbox agent spent twelve
		// iterations polling a run it could not make finish.
		expect(JOB_WATCHER_SYSTEM_PROMPT).toContain("You cannot make the job finish");
		expect(JOB_WATCHER_SYSTEM_PROMPT).toContain("has nothing new to say");
	});

	it("tells the parent this covers the smoke job too", () => {
		// The regression that prompted it: moving the smoke test onto real hardware
		// put the parent back in a submit-poll-read loop, which is the context
		// pollution the sandbox sub-agent had just removed.
		const doctrine = JOB_WATCHER_DELEGATION_DOCTRINE(JOB_WATCHER_TOOL_NAME);

		expect(doctrine).toContain("smoke test");
		expect(doctrine).toContain("What stays with you: submitting the job");
	});

	it("stops sooner than the sandbox agent", () => {
		// Reading twenty times is waiting, not working, and waiting is the
		// caller's call to make with the verdict in hand.
		expect(MAX_JOB_WATCHER_ITERATIONS).toBeLessThan(30);
	});
});

describe("truncateJobWatcherOutput", () => {
	it("keeps the end, where the traceback and exit status are", () => {
		const log = `${"progress bar line\n".repeat(2000)}Traceback: CUDA out of memory\nEXIT=1`;

		const out = truncateJobWatcherOutput(log);

		expect(out.length).toBeLessThan(log.length);
		expect(out).toContain("CUDA out of memory");
		expect(out).toContain("EXIT=1");
	});

	it("leaves a short log alone", () => {
		expect(truncateJobWatcherOutput("step 1 loss 2.3")).toBe("step 1 loss 2.3");
	});
});
