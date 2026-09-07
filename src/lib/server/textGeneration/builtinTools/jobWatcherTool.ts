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
	JOB_WATCHER_CONTEXT_MAX_PROMPT,
	JOB_WATCHER_CONTEXT_WARN_PROMPT,
	JOB_WATCHER_DELEGATION_DOCTRINE,
	JOB_WATCHER_ITERATION_LIMIT_PROMPT,
	JOB_WATCHER_REPETITION_PROMPT,
	JOB_WATCHER_SYSTEM_PROMPT,
} from "./jobWatcherPrompt";
import { createReadOnlyJobsGuard } from "./readOnlyJobsGuard";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/** The job-watcher sub-agent: an hour of polling behind one tool call. */

export const JOB_WATCHER_TOOL_NAME = "watch_job";

/** Reading operations only, enforced by the guard below — see readOnlyJobsGuard. */
const JOB_WATCHER_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["hf_jobs"]);

/** Lower than the sandbox's 30: reading twenty times is waiting, not working. */
export const MAX_JOB_WATCHER_ITERATIONS = 20;

// Harder tail-weighted than the sandbox's: a job log is mostly progress bars,
// and the traceback and exit status are at the end.
const TOOL_OUTPUT_MAX_CHARS = 6000;
const TOOL_OUTPUT_HEAD = 1200;
const TOOL_OUTPUT_TAIL = 4800;

export const truncateJobWatcherOutput = makeTruncator(
	TOOL_OUTPUT_MAX_CHARS,
	TOOL_OUTPUT_HEAD,
	TOOL_OUTPUT_TAIL
);

export type JobWatcherBuiltinTool = NestedAgentBuiltinTool;

export function isJobWatcherTool(tool: BuiltinTool): tool is JobWatcherBuiltinTool {
	return tool.name === JOB_WATCHER_TOOL_NAME && "bind" in tool;
}

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: JOB_WATCHER_TOOL_NAME,
		description:
			"Hand the watching of a job you have already submitted to a sub-agent. It polls the " +
			"logs in its own context and returns only the verdict: status, the step it reached, the " +
			"loss and whether it is falling, any warning about metrics or checkpoints not landing, " +
			"and the one error if it died.\n\n" +
			"Use it for:\n" +
			"- Watching a training run instead of cycling logs and waits yourself\n" +
			"- Watching a smoke job, where the tracebacks you are looking for are the ones you do " +
			"not want in this conversation\n" +
			"- Deciding whether a run is healthy, hung or already dead\n\n" +
			"It can only read: it cannot submit, cancel or reschedule a job. Submit the job " +
			"yourself, and decide yourself what its verdict means. A single status check is not " +
			"worth delegating; watching is.",
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
						"What you are watching for, and what would settle it. Example: 'Confirm it gets " +
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

export function createJobWatcherTool(): JobWatcherBuiltinTool {
	let deps: NestedAgentDeps | undefined;
	return {
		name: JOB_WATCHER_TOOL_NAME,
		definition,
		preprompt: JOB_WATCHER_DELEGATION_DOCTRINE(JOB_WATCHER_TOOL_NAME),
		exemptFromToolRestraint: true,
		bind(next: NestedAgentDeps) {
			deps = next;
		},
		async execute(args, ctx) {
			return runJobWatcher(args, ctx, deps);
		},
	};
}

async function runJobWatcher(
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps | undefined
): Promise<BuiltinToolResult> {
	const jobId = typeof args.job_id === "string" ? args.job_id.trim() : "";
	const task = typeof args.task === "string" ? args.task.trim() : "";
	const context = typeof args.context === "string" ? args.context.trim() : "";
	// Presence only: the server owns what a job id looks like.
	if (!jobId) return { error: "No job id provided." };
	if (!task) return { error: "No watch task provided." };
	if (!deps) return { error: "Job watcher tool not initialized for this request." };

	const spec: NestedAgentSpec = {
		label: "job-watcher",
		displayName: "Job watcher",
		systemPrompt: JOB_WATCHER_SYSTEM_PROMPT,
		task: [`Job id: ${jobId}`, context ? `Context: ${context}` : "", `Watching for: ${task}`]
			.filter(Boolean)
			.join("\n\n"),
		allowedTools: JOB_WATCHER_ALLOWED_TOOLS,
		// A custom MCP server exporting `hf_jobs` would otherwise be handed the
		// job id and dispatched to.
		requireToolServer: (server) => isHfMcpServer(server.url),
		guard: createReadOnlyJobsGuard("hf_jobs"),
		maxIterations: MAX_JOB_WATCHER_ITERATIONS,
		truncateOutput: truncateJobWatcherOutput,
		stop: {
			contextWarn: JOB_WATCHER_CONTEXT_WARN_PROMPT,
			contextMax: JOB_WATCHER_CONTEXT_MAX_PROMPT,
			iterationLimit: JOB_WATCHER_ITERATION_LIMIT_PROMPT,
			repetition: JOB_WATCHER_REPETITION_PROMPT,
		},
		failure: {
			noTools:
				"hf_jobs is not available in this deployment, so there is nothing to delegate to. Read the logs yourself.",
			contextMax: "The job watcher ran out of context before it could report on the run.",
			iterationLimit: `The job watcher hit its iteration limit (${MAX_JOB_WATCHER_ITERATIONS}) without reporting — read the logs yourself, or delegate again with a narrower question.`,
			noSummary: "The job watcher finished without reporting on the run.",
			rateLimited:
				"The job watcher is rate-limited and in-loop retries were exhausted. " +
				`Call wait for at least 120 seconds, then call ${JOB_WATCHER_TOOL_NAME} again with the same job id.`,
		},
		progress: { start: "Watching job", done: "Job watch complete" },
	};

	return runNestedAgent(spec, ctx, deps);
}
