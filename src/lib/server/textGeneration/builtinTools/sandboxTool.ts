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
	SANDBOX_CONTEXT_MAX_PROMPT,
	SANDBOX_CONTEXT_WARN_PROMPT,
	SANDBOX_DELEGATION_DOCTRINE,
	SANDBOX_ITERATION_LIMIT_PROMPT,
	SANDBOX_REPETITION_PROMPT,
	SANDBOX_SYSTEM_PROMPT,
} from "./sandboxPrompt";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/**
 * The sandbox sub-agent: the run-read-fix-run loop behind one tool call.
 *
 * Sized from the traces it was written for. Across five ML Intern runs the
 * sandbox family produced 11 uninterrupted loops of five or more calls, the
 * longest 30 calls deep, and with roughly one tool call per completion each of
 * those was a full re-prefill of a conversation that had been growing all
 * afternoon. The loop is cheap in bytes — about 1.1k per call — and expensive
 * in rounds, which is exactly the shape a sub-agent fixes.
 */

export const SANDBOX_TOOL_NAME = "sandbox_task";

/**
 * Exec and file access inside a sandbox that already exists — nothing that
 * creates, terminates or costs. A sub-agent's calls bypass the parent's guard
 * chain (see nestedAgent.ts), and `hf_sandbox` create is budget-gated, so
 * holding it here would let a delegated loop reserve compute outside the
 * pre-flight list the user is shown. The parent keeps the lifecycle.
 */
const SANDBOX_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["hf_sandbox_exec", "hf_sandbox_fs"]);

/** The longest sandbox loop in the traces ran 30 calls; past that it is stuck, not working. */
export const MAX_SANDBOX_ITERATIONS = 30;

// Tail-weighted, unlike research's near-even split: a command's output ends
// with the traceback and the exit status, which is the part worth keeping.
const TOOL_OUTPUT_MAX_CHARS = 6000;
const TOOL_OUTPUT_HEAD = 1800;
const TOOL_OUTPUT_TAIL = 4200;

export const truncateSandboxToolOutput = makeTruncator(
	TOOL_OUTPUT_MAX_CHARS,
	TOOL_OUTPUT_HEAD,
	TOOL_OUTPUT_TAIL
);

export type SandboxBuiltinTool = NestedAgentBuiltinTool;

export function isSandboxTool(tool: BuiltinTool): tool is SandboxBuiltinTool {
	return tool.name === SANDBOX_TOOL_NAME && "bind" in tool;
}

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: SANDBOX_TOOL_NAME,
		description:
			"Hand a run-it-until-it-works loop to a sub-agent inside a sandbox you have already " +
			"created. The sub-agent runs commands, reads the errors, edits the files and re-runs in " +
			"its own context, and returns only what you need next: the command that worked, the " +
			"files it changed, the names it touched, or the one error that stopped it.\n\n" +
			"Use it for:\n" +
			"- Getting a script to import and run before you submit it as a job\n" +
			"- Smoke-testing a training script on a tiny slice\n" +
			"- Debugging a failure whose fix is edit-and-rerun\n" +
			"- Checking data shapes, versions or environment inside the sandbox\n\n" +
			"It cannot create or terminate sandboxes, submit jobs, or write to the Hub — do those " +
			"yourself. A single command you want to look at is not worth delegating; a loop is.",
		parameters: {
			type: "object",
			properties: {
				handle: {
					type: "string",
					description:
						"The sandbox handle from hf_sandbox create, e.g. hfsb2:<namespace>:<id>. The " +
						"sub-agent works only in this sandbox.",
				},
				task: {
					type: "string",
					description:
						"What to achieve, and what would prove it. Name the paths involved and the check " +
						"that counts. Example: 'Make /data/train.py import cleanly and complete 2 steps on " +
						"the first 100 rows of the dataset at /data/train.jsonl. It works when the script " +
						"prints a loss for step 2.'",
				},
				context: {
					type: "string",
					description:
						"Optional context the sub-agent needs and cannot see: what is being built, the " +
						"versions you pinned, what you already tried.",
				},
			},
			required: ["handle", "task"],
		},
	},
};

export function createSandboxTool(): SandboxBuiltinTool {
	// Definition and enablement are static; the request plumbing only exists
	// inside runMcpFlow, which binds it before the tool loop starts.
	let deps: NestedAgentDeps | undefined;
	return {
		name: SANDBOX_TOOL_NAME,
		definition,
		preprompt: SANDBOX_DELEGATION_DOCTRINE(SANDBOX_TOOL_NAME),
		exemptFromToolRestraint: true,
		bind(next: NestedAgentDeps) {
			deps = next;
		},
		async execute(args, ctx) {
			return runSandboxTask(args, ctx, deps);
		},
	};
}

async function runSandboxTask(
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps | undefined
): Promise<BuiltinToolResult> {
	const handle = typeof args.handle === "string" ? args.handle.trim() : "";
	const task = typeof args.task === "string" ? args.task.trim() : "";
	const context = typeof args.context === "string" ? args.context.trim() : "";
	// Deliberately only a presence check. The server accepts three handle forms
	// and is the authority on which; refusing a shape it would have taken is the
	// mistake this codebase already learned once.
	if (!handle) return { error: "No sandbox handle provided." };
	if (!task) return { error: "No sandbox task provided." };
	if (!deps) return { error: "Sandbox tool not initialized for this request." };

	const spec: NestedAgentSpec = {
		label: "sandbox",
		displayName: "Sandbox",
		systemPrompt: SANDBOX_SYSTEM_PROMPT,
		task: [`Sandbox handle: ${handle}`, context ? `Context: ${context}` : "", `Task: ${task}`]
			.filter(Boolean)
			.join("\n\n"),
		allowedTools: SANDBOX_ALLOWED_TOOLS,
		// The names are the Hub's, and so must be the server: a custom MCP server
		// exporting `hf_sandbox_exec` would otherwise be handed the handle and the
		// task, and dispatched to without the parent's guard chain.
		requireToolServer: (server) => isHfMcpServer(server.url),
		maxIterations: MAX_SANDBOX_ITERATIONS,
		truncateOutput: truncateSandboxToolOutput,
		stop: {
			contextWarn: SANDBOX_CONTEXT_WARN_PROMPT,
			contextMax: SANDBOX_CONTEXT_MAX_PROMPT,
			iterationLimit: SANDBOX_ITERATION_LIMIT_PROMPT,
			repetition: SANDBOX_REPETITION_PROMPT,
		},
		failure: {
			noTools:
				"The sandbox tools are not available in this deployment, so there is nothing to delegate to. Run the commands yourself.",
			contextMax: "The sandbox sub-agent ran out of context before it could report.",
			iterationLimit: `The sandbox sub-agent hit its iteration limit (${MAX_SANDBOX_ITERATIONS}) without reporting — the task is probably too broad for one delegation, or the sandbox is not in the state it expected.`,
			noSummary: "The sandbox sub-agent finished without reporting what it did.",
			rateLimited:
				"The sandbox sub-agent is rate-limited and in-loop retries were exhausted. " +
				`Call wait for at least 120 seconds, then call ${SANDBOX_TOOL_NAME} again with the same task.`,
		},
		progress: { start: "Starting sandbox sub-agent", done: "Sandbox task complete" },
	};

	return runNestedAgent(spec, ctx, deps);
}
