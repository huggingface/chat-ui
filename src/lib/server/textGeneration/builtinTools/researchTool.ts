import type { OpenAI } from "openai";
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { logger } from "$lib/server/logger";
import { GITHUB_FIND_EXAMPLES, GITHUB_LIST_REPOS, GITHUB_READ_FILE } from "$lib/server/github";
import type { McpToolMapping, OpenAiTool } from "$lib/server/mcp/tools";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { executeToolCalls, type NormalizedToolCall } from "../mcp/toolInvocation";
import { parseToolArguments } from "../mcp/toolArgs";
import { stripLoneSurrogates } from "../utils/loneSurrogates";
import { isRateLimitError, withUpstreamRetry } from "../utils/upstreamRetry";
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

// Fractions of the model's usable context (window minus the completion
// reserve) at which the budget prompts fire — the source fired at 170k/190k
// of an assumed 200k window, which these reproduce when no reserve is set.
const CONTEXT_WARN_FRACTION = 0.85;
const CONTEXT_MAX_FRACTION = 0.95;
const FALLBACK_CONTEXT_WINDOW = 200_000;

// Head/tail split preserved from the source: the head carries the finding,
// the tail carries the footer/totals a long listing usually ends with.
const TOOL_OUTPUT_MAX_CHARS = 8000;
const TOOL_OUTPUT_HEAD = 4800;
const TOOL_OUTPUT_TAIL = 3200;

const NESTED_CALL_TIMEOUT_MS = 120_000;

export function truncateResearchToolOutput(output: string): string {
	if (output.length <= TOOL_OUTPUT_MAX_CHARS) return output;
	// Both slice points can land mid-surrogate-pair; see loneSurrogates.ts for
	// why one such character 400s every request that carries the message.
	return stripLoneSurrogates(
		output.slice(0, TOOL_OUTPUT_HEAD) + "\n...(truncated)...\n" + output.slice(-TOOL_OUTPUT_TAIL)
	);
}

export type ResearchCompletionBase = Omit<ChatCompletionCreateParamsStreaming, "messages"> & {
	reasoning_effort?: "low" | "medium" | "high";
};

export interface ResearchRuntimeDeps {
	openai: OpenAI;
	/**
	 * The main loop's request base. The nested loop swaps stream/tools/messages
	 * and inherits everything else — model, sampling, reasoning effort. ml-intern
	 * downgraded max/xhigh reasoning to "high" for this sub-call; this codebase's
	 * effort type already tops out at "high", so inheriting is the cap.
	 */
	completionBase: ResearchCompletionBase;
	requestHeaders: Record<string, string>;
	servers: McpServerConfig[];
	mapping: Record<string, McpToolMapping>;
	mcpTools: OpenAiTool[];
	/** Every builtin offered this turn, research itself included; filtered by the allowlist here. */
	hostBuiltinTools: BuiltinTool[];
	contextLengthTokens?: number;
}

export interface ResearchBuiltinTool extends BuiltinTool {
	bind(deps: ResearchRuntimeDeps): void;
}

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

/** JSON with object keys sorted at every depth, so arg order can't defeat the repetition check. */
const stableStringify = (value: unknown): string =>
	JSON.stringify(value, (_key, val: unknown) =>
		val && typeof val === "object" && !Array.isArray(val)
			? Object.fromEntries(
					Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
				)
			: val
	) ?? "";

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

	const allowedBuiltins = deps.hostBuiltinTools.filter((tool) =>
		RESEARCH_ALLOWED_TOOLS.has(tool.name)
	);
	const builtinNames = new Set(allowedBuiltins.map((tool) => tool.name));
	const nestedTools: OpenAiTool[] = [
		...allowedBuiltins.map((tool) => tool.definition),
		...deps.mcpTools.filter(
			(tool) =>
				RESEARCH_ALLOWED_TOOLS.has(tool.function.name) && !builtinNames.has(tool.function.name)
		),
	];
	if (nestedTools.length === 0) {
		return { error: "No research tools are available in this deployment." };
	}
	const availableNames = new Set(nestedTools.map((tool) => tool.function.name));

	let messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: buildResearchSystemPrompt(availableNames) },
		{
			role: "user",
			content: context ? `Context: ${context}\n\nResearch task: ${task}` : `Research task: ${task}`,
		},
	];

	// The parent's tool set and tool_choice never reach the sub-agent; stream
	// is overridden per request below.
	const base = { ...deps.completionBase };
	delete base.tools;
	delete base.tool_choice;

	// Budget thresholds are fractions of the USABLE window: what remains after
	// reserving the completion allowance every request asks for. Without the
	// reservation, a large max_tokens lets a request exceed the window between
	// the 85% nudge and the 95% stop — an unrecoverable provider error instead
	// of a forced summary. The floor guards a degenerate reserve that would
	// leave no room to research at all.
	const windowTokens = deps.contextLengthTokens ?? FALLBACK_CONTEXT_WINDOW;
	const completionReserve = typeof base.max_tokens === "number" ? base.max_tokens : 0;
	const usableTokens = Math.max(windowTokens - completionReserve, Math.floor(windowTokens / 4));
	const contextWarnAt = Math.floor(usableTokens * CONTEXT_WARN_FRACTION);
	const contextMaxAt = Math.floor(usableTokens * CONTEXT_MAX_FRACTION);

	const complete = async (withTools: boolean) => {
		const request: ChatCompletionCreateParamsNonStreaming = {
			...base,
			stream: false,
			messages,
			// Omitting `tools` entirely is what forces the final summary: the
			// budget prompt alone is a suggestion the model can ignore; an
			// absent tool list is a constraint it can't.
			...(withTools ? { tools: nestedTools, tool_choice: "auto" as const } : {}),
		};
		return deps.openai.chat.completions.create(request, {
			signal: ctx.abortSignal,
			headers: deps.requestHeaders,
			timeout: NESTED_CALL_TIMEOUT_MS,
		});
	};

	const emitProgress = (iteration: number, message: string) => {
		ctx.elicitationSink?.emit({
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Progress,
			uuid: ctx.uuid,
			progress: iteration,
			total: MAX_RESEARCH_ITERATIONS,
			message,
		});
	};

	// A throttle or a brief router outage mid-run must not discard the
	// iterations already spent; the run is minutes long anyway, so it absorbs
	// the backoff itself. Only when the schedule runs out does the error surface
	// — with instructions to wait, so the model reaches for the wait tool
	// instead of hammering research again.
	const completeWithRetry = (withTools: boolean, iteration: number) =>
		withUpstreamRetry(() => complete(withTools), {
			signal: ctx.abortSignal,
			onBackoff: (attempt, delayMs, err) => {
				logger.warn(
					{ attempt, delayMs, iteration, err: String(err) },
					"[research] upstream failure; backing off in-loop"
				);
				const cause = isRateLimitError(err) ? "Rate limited" : "Upstream error";
				emitProgress(iteration, `${cause} — retrying in ${Math.round(delayMs / 1000)}s`);
			},
		});

	const forcedSummary = async (
		stopPrompt: string,
		failureText: string
	): Promise<BuiltinToolResult> => {
		messages = [...messages, { role: "user", content: stopPrompt }];
		try {
			const response = await completeWithRetry(false, MAX_RESEARCH_ITERATIONS);
			const content = response.choices[0]?.message?.content ?? "";
			return content ? { resultText: content } : { error: failureText };
		} catch (err) {
			logger.warn({ err: String(err) }, "[research] forced summary call failed");
			return { error: failureText };
		}
	};

	let totalTokens = 0;
	let warned = false;
	const callCounts = new Map<string, number>();
	let repetitionNudged = false;
	let lengthCutRetries = 0;

	emitProgress(0, "Starting research sub-agent");

	for (let iteration = 0; iteration < MAX_RESEARCH_ITERATIONS; iteration += 1) {
		if (ctx.abortSignal?.aborted) return { error: "Aborted by user" };

		if (totalTokens >= contextMaxAt) {
			logger.warn({ totalTokens, iteration }, "[research] context max reached; forcing summary");
			emitProgress(iteration, "Context limit reached — wrapping up");
			return forcedSummary(
				RESEARCH_CONTEXT_MAX_PROMPT,
				"Research context exhausted and no summary was produced."
			);
		}
		if (!warned && totalTokens >= contextWarnAt) {
			warned = true;
			messages = [...messages, { role: "user", content: RESEARCH_CONTEXT_WARN_PROMPT }];
		}

		let response: Awaited<ReturnType<typeof complete>>;
		try {
			response = await completeWithRetry(true, iteration);
		} catch (err) {
			if (ctx.abortSignal?.aborted) return { error: "Aborted by user" };
			const message = err instanceof Error ? err.message : String(err);
			logger.warn({ err: message, iteration }, "[research] sub-agent LLM call failed");
			if (isRateLimitError(err)) {
				return {
					error:
						"Research is rate-limited and in-loop retries were exhausted. " +
						"Call wait for at least 120 seconds, then call research again with the same task.",
				};
			}
			return { error: `Research agent LLM error: ${message}` };
		}

		totalTokens =
			response.usage?.total_tokens ??
			// No usage from this provider: a rough absolute estimate keeps the
			// budget stop functional instead of never firing.
			Math.ceil(JSON.stringify(messages).length / 4);

		const msg = response.choices[0]?.message;
		const finishReason = response.choices[0]?.finish_reason;
		const toolCalls = msg?.tool_calls ?? [];
		if (!msg || toolCalls.length === 0) {
			// Cut by the output limit is not a finished summary — with reasoning
			// models it usually died mid-think. Nudge it to answer within budget;
			// after two cuts, surface whatever content exists rather than looping.
			if (finishReason === "length" && lengthCutRetries < 2) {
				lengthCutRetries += 1;
				logger.warn(
					{ iteration, attempt: lengthCutRetries },
					"[research] response cut by the output limit; nudging to finish"
				);
				messages = [
					...messages,
					{
						role: "assistant",
						content:
							msg?.content?.trim() || "(Response cut off by the output limit mid-reasoning.)",
					},
					{
						role: "user",
						content:
							"[SYSTEM: Your previous response hit the output limit before it finished. Continue: finish the step or produce the summary now, with minimal further reasoning.]",
					},
				];
				continue;
			}
			const content = msg?.content ?? "";
			emitProgress(iteration + 1, "Research complete");
			return content
				? { resultText: content }
				: { error: "Research completed but no summary was generated." };
		}

		// Wire-safe rebuild: only role/content/tool_calls go back. The raw
		// message can carry provider fields (reasoning_content and friends)
		// that OpenAI-compatible backends reject when echoed; content is
		// omitted when empty because some backends 400 on empty text next to
		// tool_calls.
		messages = [
			...messages,
			{
				role: "assistant",
				tool_calls: toolCalls,
				...(typeof msg.content === "string" && msg.content.trim().length > 0
					? { content: msg.content }
					: {}),
			},
		];

		const allowedCalls: NormalizedToolCall[] = [];
		const refusals: ChatCompletionMessageParam[] = [];
		let sawRepetition = false;
		for (const call of toolCalls) {
			const name = call.function?.name ?? "";
			if (!availableNames.has(name)) {
				refusals.push({
					role: "tool",
					tool_call_id: call.id,
					content: `Tool '${name}' not available for research.`,
				});
				continue;
			}
			const rawArguments = call.function?.arguments ?? "";
			const key = `${name}|${stableStringify(parseToolArguments(rawArguments) ?? rawArguments)}`;
			const count = (callCounts.get(key) ?? 0) + 1;
			callCounts.set(key, count);
			if (count >= 3) sawRepetition = true;
			allowedCalls.push({ id: call.id, name, arguments: rawArguments });
		}

		let toolMessages: ChatCompletionMessageParam[] = [];
		if (allowedCalls.length > 0) {
			emitProgress(
				iteration + 1,
				allowedCalls.map((call) => `▸ ${call.name} ${call.arguments.slice(0, 80)}`).join("  ")
			);
			const exec = executeToolCalls({
				calls: allowedCalls,
				mapping: deps.mapping,
				servers: deps.servers,
				parseArgs: parseToolArguments,
				toPrimitive: (value) =>
					typeof value === "string" || typeof value === "number" || typeof value === "boolean"
						? value
						: undefined,
				processToolOutput: (text) => ({ annotated: text, sources: [] }),
				abortSignal: ctx.abortSignal,
				builtinTools: allowedBuiltins,
				// No `elicitation`: the sub-agent has no chat to ask, so an
				// input-required response comes back as an ordinary tool error.
			});
			for await (const event of exec) {
				// The sub-agent's raw Call/Result updates stay internal — the
				// whole point is that only the summary reaches the outer
				// conversation. Progress is reported on the research call itself.
				if (event.type === "complete") {
					toolMessages = event.summary.toolMessages;
				}
			}
		}

		messages = [
			...messages,
			...refusals,
			...toolMessages.map((message) =>
				message.role === "tool" && typeof message.content === "string"
					? { ...message, content: truncateResearchToolOutput(message.content) }
					: message
			),
		];

		if (sawRepetition && !repetitionNudged) {
			repetitionNudged = true;
			logger.warn({ iteration }, "[research] repetition guard activated");
			messages = [...messages, { role: "user", content: RESEARCH_REPETITION_PROMPT }];
		}
	}

	logger.warn({}, "[research] iteration limit reached; extracting summary");
	emitProgress(MAX_RESEARCH_ITERATIONS, "Iteration limit reached — extracting summary");
	return forcedSummary(
		RESEARCH_ITERATION_LIMIT_PROMPT,
		`Research agent hit the iteration limit (${MAX_RESEARCH_ITERATIONS}) and no summary was produced — try a more focused task.`
	);
}
