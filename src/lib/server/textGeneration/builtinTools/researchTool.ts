import { GITHUB_FIND_EXAMPLES, GITHUB_LIST_REPOS, GITHUB_READ_FILE } from "$lib/server/github";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import {
	makeTruncator,
	runNestedAgent,
	type NestedAgentBuiltinTool,
	type NestedAgentDeps,
	type NestedCompletionBase,
} from "./nestedAgent";
import {
	buildResearchSystemPrompt,
	RESEARCH_CONTEXT_MAX_PROMPT,
	RESEARCH_CONTEXT_WARN_PROMPT,
	RESEARCH_ITERATION_LIMIT_PROMPT,
	RESEARCH_REPETITION_PROMPT,
} from "./researchPrompt";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/**
 * The research sub-agent, ported from ml-intern's research_tool.py: a complete
 * nested agent loop behind one tool call. It runs on a fresh message array —
 * nothing inherited from the parent conversation — against a read-only tool
 * allowlist, and only its final summary ever reaches the main context. That is
 * the point: a literature pass costs the main turn one round, and no raw
 * search results land in it.
 */

export const RESEARCH_TOOL_NAME = "research";

/**
 * Read-only set only. Absent entries are simply not offered (no Exa server
 * configured, no GITHUB_TOKEN); the system prompt adjusts to what exists.
 * `research` itself is deliberately not here — no recursive sub-agents.
 */
const RESEARCH_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
	"hf_fs",
	"hub_repo_details",
	"hub_repo_search",
	GITHUB_FIND_EXAMPLES,
	GITHUB_READ_FILE,
	GITHUB_LIST_REPOS,
	"web_search_exa",
	"get_code_context_exa",
	"crawling_exa",
]);

export const MAX_RESEARCH_ITERATIONS = 60;

// Head/tail split preserved from the source: the head carries the finding,
// the tail carries the footer/totals a long listing usually ends with.
const TOOL_OUTPUT_MAX_CHARS = 8000;
const TOOL_OUTPUT_HEAD = 4800;
const TOOL_OUTPUT_TAIL = 3200;

export const truncateResearchToolOutput = makeTruncator(
	TOOL_OUTPUT_MAX_CHARS,
	TOOL_OUTPUT_HEAD,
	TOOL_OUTPUT_TAIL
);

export type ResearchCompletionBase = NestedCompletionBase;

export type ResearchRuntimeDeps = NestedAgentDeps;

export type ResearchBuiltinTool = NestedAgentBuiltinTool;

export function isResearchTool(tool: BuiltinTool): tool is ResearchBuiltinTool {
	return tool.name === RESEARCH_TOOL_NAME && "bind" in tool;
}

const RESEARCH_DOCTRINE =
	`RESEARCH DELEGATION: ${RESEARCH_TOOL_NAME} is how you ground research-shaped work, and research-shaped work ALWAYS starts with it. ` +
	`Reproducing or implementing a paper, surveying training recipes, comparing methods, finding and reading reference implementations before writing training code — for every one of these your first call is ${RESEARCH_TOOL_NAME}; do not do the crawling in this conversation. ` +
	`The sub-agent runs its own search-and-read loop in a separate context and returns a short attributed summary, so a full literature pass costs this conversation one tool round and no raw dumps land in your context. ` +
	`Give it a specific task — the paper id or URL, the libraries, models and datasets you already know — plus a sentence of conversation context. ` +
	`The only lookups that skip it are single already-named facts: one model id, one dataset's schema, one doc page.`;

const definition: OpenAiTool = {
	type: "function",
	function: {
		name: RESEARCH_TOOL_NAME,
		description:
			"Spawn a research sub-agent to explore papers, documentation, datasets and code WITHOUT " +
			"polluting the main conversation context. The sub-agent gets its own independent context " +
			"window with read-only research tools and returns a concise summary of findings.\n\n" +
			"ALWAYS use this first for:\n" +
			"- Reproducing or implementing a paper (pass the paper id or URL in the task)\n" +
			"- Surveying the literature for training recipes before implementing an ML task\n" +
			"- Researching current API usage before writing code (find examples + read docs)\n" +
			"- Reading papers, auditing datasets, analyzing repos — any research where raw tool " +
			"outputs would be too verbose\n\n" +
			"The sub-agent knows how to use the paper index, hub_repo_details, the GitHub grounding " +
			"tools, web search, etc. Just describe what you need researched.",
		parameters: {
			type: "object",
			properties: {
				task: {
					type: "string",
					description:
						"Detailed description of what to research. Be specific: include library names, " +
						"trainer types, dataset names, repo names, or doc pages to explore. Example: " +
						"'Research current TRL SFTTrainer usage: find working example scripts, read the " +
						"SFT documentation, and check SFTConfig parameters. Also validate that dataset " +
						"HuggingFaceH4/ultrachat_200k has the right format for SFT.'",
				},
				context: {
					type: "string",
					description:
						"Optional context from the current conversation that the research agent needs " +
						"(e.g., what the user wants to build, constraints, what's been tried).",
				},
			},
			required: ["task"],
		},
	},
};

export function createResearchTool(): ResearchBuiltinTool {
	// Definition and enablement are static; the request plumbing (client,
	// sampling params, the turn's listed MCP tools) only exists inside
	// runMcpFlow, which binds it here before the tool loop starts.
	let deps: ResearchRuntimeDeps | undefined;
	return {
		name: RESEARCH_TOOL_NAME,
		definition,
		preprompt: RESEARCH_DOCTRINE,
		exemptFromToolRestraint: true,
		bind(next: ResearchRuntimeDeps) {
			deps = next;
		},
		async execute(args, ctx) {
			return runResearch(args, ctx, deps);
		},
	};
}

async function runResearch(
	args: Record<string, unknown>,
	ctx: BuiltinToolContext,
	deps: ResearchRuntimeDeps | undefined
): Promise<BuiltinToolResult> {
	const task = typeof args.task === "string" ? args.task.trim() : "";
	const context = typeof args.context === "string" ? args.context.trim() : "";
	if (!task) return { error: "No research task provided." };
	if (!deps) return { error: "Research tool not initialized for this request." };

	return runNestedAgent(
		{
			label: "research",
			displayName: "Research",
			systemPrompt: buildResearchSystemPrompt(
				availableResearchToolNames(deps, RESEARCH_ALLOWED_TOOLS)
			),
			task: context ? `Context: ${context}\n\nResearch task: ${task}` : `Research task: ${task}`,
			allowedTools: RESEARCH_ALLOWED_TOOLS,
			maxIterations: MAX_RESEARCH_ITERATIONS,
			truncateOutput: truncateResearchToolOutput,
			stop: {
				contextWarn: RESEARCH_CONTEXT_WARN_PROMPT,
				contextMax: RESEARCH_CONTEXT_MAX_PROMPT,
				iterationLimit: RESEARCH_ITERATION_LIMIT_PROMPT,
				repetition: RESEARCH_REPETITION_PROMPT,
			},
			failure: {
				noTools: "No research tools are available in this deployment.",
				contextMax: "Research context exhausted and no summary was produced.",
				iterationLimit: `Research agent hit the iteration limit (${MAX_RESEARCH_ITERATIONS}) and no summary was produced — try a more focused task.`,
				noSummary: "Research completed but no summary was generated.",
				rateLimited:
					"Research is rate-limited and in-loop retries were exhausted. " +
					"Call wait for at least 120 seconds, then call research again with the same task.",
			},
			progress: { start: "Starting research sub-agent", done: "Research complete" },
		},
		ctx,
		deps
	);
}

/**
 * The allowlisted tools this deployment actually offers. The research system
 * prompt names them, so it has to be built from what exists rather than from
 * the allowlist: an absent Exa server or GITHUB_TOKEN must not be advertised.
 */
function availableResearchToolNames(
	deps: ResearchRuntimeDeps,
	allowed: ReadonlySet<string>
): Set<string> {
	const builtins = deps.hostBuiltinTools.filter((tool) => allowed.has(tool.name));
	const names = new Set(builtins.map((tool) => tool.name));
	for (const tool of deps.mcpTools) {
		if (allowed.has(tool.function.name)) names.add(tool.function.name);
	}
	return names;
}
