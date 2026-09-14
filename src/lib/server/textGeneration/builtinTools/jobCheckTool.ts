import { isHfMcpServer } from "$lib/server/mcp/hf";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import {
	makeTruncator,
	runNestedAgent,
	type NestedAgentBuiltinTool,
	type NestedAgentDeps,
	type NestedAgentSpec,
} from "./nestedAgent";
import {
	JOB_CHECK_CONTEXT_MAX_PROMPT,
	JOB_CHECK_CONTEXT_WARN_PROMPT,
	JOB_CHECK_DELEGATION_DOCTRINE,
	JOB_CHECK_ITERATION_LIMIT_PROMPT,
	JOB_CHECK_REPETITION_PROMPT,
	JOB_CHECK_SYSTEM_PROMPT,
} from "./jobCheckPrompt";
import { createReadOnlyJobsGuard } from "./readOnlyJobsGuard";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/** Reads a running job and returns a verdict, so its log tails stay out of the parent. */

export const JOB_CHECK_TOOL_NAME = "check_job";

/** Reading operations only, enforced by the guard below — see readOnlyJobsGuard. */
const JOB_CHECK_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["hf_jobs"]);

/**
 * One pass, not a watch: enough to read the tail, inspect, and finish a
 * truncated read. It cannot wait (see jobCheckPrompt), so a higher cap would
 * only buy tight-polling.
 */
export const MAX_JOB_CHECK_ITERATIONS = 8;

// Harder tail-weighted than the sandbox's: a job log is mostly progress bars,
// and the traceback and exit status are at the end.
const TOOL_OUTPUT_MAX_CHARS = 6000;
const TOOL_OUTPUT_HEAD = 1200;
const TOOL_OUTPUT_TAIL = 4800;

export const truncateJobCheckOutput = makeTruncator(
	TOOL_OUTPUT_MAX_CHARS,
	TOOL_OUTPUT_HEAD,
	TOOL_OUTPUT_TAIL
);

export type JobCheckBuiltinTool = NestedAgentBuiltinTool;

export function isJobCheckTool(tool: BuiltinTool): tool is JobCheckBuiltinTool {
	return tool.name === JOB_CHECK_TOOL_NAME && "bind" in tool;
}

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: JOB_CHECK_TOOL_NAME,
		description:
			"Read a job you have already submitted, in a sub-agent, and get back only the " +
			"verdict: status, the step it reached, the loss and whether it is falling, any warning " +
			"about metrics or checkpoints not landing, and the one error if it died.\n\n" +
			"Use it for:\n" +
			"- Checking a training run instead of reading its logs in this conversation\n" +
			"- Checking a smoke job, whose tracebacks are the ones you least want in here\n" +
			"- Deciding whether a run is healthy, hung or already dead\n\n" +
			"It reads once and reports; it cannot wait. Call wait yourself for the delay, then " +
			"call this again — as often as the run needs. It cannot submit, cancel or reschedule " +
			"a job either, and what its verdict means is your decision.",
		parameters: {
			type: "object",
			properties: {
				job_id: {
					type: "string",
					description: "The id returned when the job was submitted.",
				},
				task: {
					type: "string",
					description:
						"What you are checking for, and what would settle it. Example: 'Confirm it got " +
						"past step 1 without an OOM at batch size 8, and report the steps-per-second so I " +
						"can size the real run's timeout.'",
				},
				context: {
					type: "string",
					description:
						"Optional context the watcher cannot see: what the job is training, the flavor " +
						"and shape you submitted, what failed on a previous attempt.",
				},
			},
			required: ["job_id", "task"],
		},
	},
};

export function createJobCheckTool(): JobCheckBuiltinTool {
	let deps: NestedAgentDeps | undefined;
	return {
		name: JOB_CHECK_TOOL_NAME,
		definition,
		preprompt: JOB_CHECK_DELEGATION_DOCTRINE(JOB_CHECK_TOOL_NAME),
		exemptFromToolRestraint: true,
		bind(next: NestedAgentDeps) {
			deps = next;
		},
		async execute(args, ctx) {
			return runJobCheck(args, ctx, deps);
		},
	};
}

async function runJobCheck(
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps | undefined
): Promise<BuiltinToolResult> {
	const jobId = typeof args.job_id === "string" ? args.job_id.trim() : "";
	const task = typeof args.task === "string" ? args.task.trim() : "";
	const context = typeof args.context === "string" ? args.context.trim() : "";
	// Presence only: the server owns what a job id looks like.
	if (!jobId) return { error: "No job id provided." };
	if (!task) return { error: "No check task provided." };
	if (!deps) return { error: "Job check tool not initialized for this request." };

	const spec: NestedAgentSpec = {
		label: "job-check",
		displayName: "Job check",
		systemPrompt: JOB_CHECK_SYSTEM_PROMPT,
		task: [`Job id: ${jobId}`, context ? `Context: ${context}` : "", `Checking for: ${task}`]
			.filter(Boolean)
			.join("\n\n"),
		allowedTools: JOB_CHECK_ALLOWED_TOOLS,
		// A custom MCP server exporting `hf_jobs` would otherwise be handed the
		// job id and dispatched to.
		requireToolServer: (server) => isHfMcpServer(server.url),
		guard: createReadOnlyJobsGuard("hf_jobs"),
		maxIterations: MAX_JOB_CHECK_ITERATIONS,
		truncateOutput: truncateJobCheckOutput,
		stop: {
			contextWarn: JOB_CHECK_CONTEXT_WARN_PROMPT,
			contextMax: JOB_CHECK_CONTEXT_MAX_PROMPT,
			iterationLimit: JOB_CHECK_ITERATION_LIMIT_PROMPT,
			repetition: JOB_CHECK_REPETITION_PROMPT,
		},
		failure: {
			noTools:
				"hf_jobs is not available in this deployment, so there is nothing to delegate to. Read the logs yourself.",
			contextMax: "The job check ran out of context before it could report on the run.",
			iterationLimit: `The job check hit its iteration limit (${MAX_JOB_CHECK_ITERATIONS}) without reporting — read the logs yourself, or ask it a narrower question.`,
			noSummary: "The job check finished without reporting on the run.",
			rateLimited:
				"The job check is rate-limited and in-loop retries were exhausted. " +
				`Call wait for at least 120 seconds, then call ${JOB_CHECK_TOOL_NAME} again with the same job id.`,
		},
		progress: { start: "Checking job", done: "Job check complete" },
	};

	return runNestedAgent(spec, ctx, deps);
}
