import type { OpenAI } from "openai";
import type {
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { logger } from "$lib/server/logger";
import type { McpToolMapping, OpenAiTool } from "$lib/server/mcp/tools";
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { executeToolCalls, type NormalizedToolCall } from "../mcp/toolInvocation";
import { parseToolArguments, withParseableArguments } from "../mcp/toolArgs";
import { stripLoneSurrogates } from "../utils/loneSurrogates";
import { isRateLimitError, withUpstreamRetry } from "../utils/upstreamRetry";
import type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";

/**
 * The loop behind a sub-agent tool: a complete nested agent run on a fresh
 * message array, against a tool allowlist, whose only trace in the parent
 * conversation is the string it returns.
 *
 * Extracted from the research tool when a second sub-agent arrived. Everything
 * here is the machinery neither agent should have to reimplement — the context
 * budget and its forced summary, the iteration cap, the repetition guard, the
 * wire-safe message rebuild, output truncation, backoff. What differs between
 * agents is the spec below: the prompts, the allowlist, and the limits.
 *
 * One invariant is not expressed in the types and matters: a sub-agent's tool
 * calls do not pass through the parent's guard chain (budget, preflight,
 * repeat). An allowlist may therefore only contain tools that spend nothing and
 * create nothing — reads, and work inside a resource the parent already made.
 */

const CONTEXT_WARN_FRACTION = 0.85;
const CONTEXT_MAX_FRACTION = 0.95;
const FALLBACK_CONTEXT_WINDOW = 200_000;
const NESTED_CALL_TIMEOUT_MS = 120_000;
/** A call repeated this many times with identical arguments earns the nudge. */
const REPETITION_THRESHOLD = 3;
/** Two cuts and the run reports what it has rather than looping on the limit. */
const MAX_LENGTH_CUT_RETRIES = 2;

export type NestedCompletionBase = Omit<ChatCompletionCreateParamsStreaming, "messages"> & {
	reasoning_effort?: "low" | "medium" | "high";
};

export interface NestedAgentDeps {
	openai: OpenAI;
	/**
	 * The main loop's request base. The nested loop swaps stream/tools/messages
	 * and inherits everything else — model, sampling, reasoning effort.
	 */
	completionBase: NestedCompletionBase;
	requestHeaders: Record<string, string>;
	servers: McpServerConfig[];
	mapping: Record<string, McpToolMapping>;
	mcpTools: OpenAiTool[];
	/** Every builtin offered this turn; filtered by the spec's allowlist here. */
	hostBuiltinTools: BuiltinTool[];
	contextLengthTokens?: number;
}

export interface NestedAgentSpec {
	/** Lowercase, for log prefixes: `[research]`, `[sandbox]`. */
	label: string;
	/** Sentence-cased, for model-facing error text: "Research agent LLM error". */
	displayName: string;
	systemPrompt: string;
	/** The single user message the run starts from. */
	task: string;
	allowedTools: ReadonlySet<string>;
	/**
	 * Where an allowlisted MCP tool has to come from, when the name alone is not
	 * proof. Any selected server may export a tool called `hf_sandbox_exec`, and
	 * a name only gets a collision suffix when two servers offer it at once — so
	 * if the Hub's listing omits it or fails, a custom server's tool inherits the
	 * bare name and clears a name-only allowlist. The sub-agent would then hand
	 * that server a Hub sandbox handle, outside the parent's guard chain.
	 *
	 * Omitted where an agent's tools legitimately span servers and are read-only.
	 */
	requireToolServer?: (server: McpServerConfig) => boolean;
	maxIterations: number;
	truncateOutput(text: string): string;
	/** Injected to steer the loop when it has to stop or is going in circles. */
	stop: {
		contextWarn: string;
		contextMax: string;
		iterationLimit: string;
		repetition: string;
	};
	/** Returned when a run ends with nothing usable. */
	failure: {
		noTools: string;
		contextMax: string;
		iterationLimit: string;
		noSummary: string;
		rateLimited: string;
	};
	progress: { start: string; done: string };
}

/**
 * A builtin whose definition is static but whose loop needs the turn's request
 * plumbing. runMcpFlow binds every one of these with the same deps, so a new
 * sub-agent is registered in one place and wired in none.
 */
export interface NestedAgentBuiltinTool extends BuiltinTool {
	bind(deps: NestedAgentDeps): void;
}

export function isNestedAgentTool(tool: BuiltinTool): tool is NestedAgentBuiltinTool {
	return typeof (tool as { bind?: unknown }).bind === "function";
}

/** Head and tail, because the head carries the finding and the tail the totals. */
export function makeTruncator(maxChars: number, head: number, tail: number) {
	return (output: string): string => {
		if (output.length <= maxChars) return output;
		// Both slice points can land mid-surrogate-pair; see loneSurrogates.ts for
		// why one such character 400s every request that carries the message.
		return stripLoneSurrogates(
			output.slice(0, head) + "\n...(truncated)...\n" + output.slice(-tail)
		);
	};
}

/** JSON with object keys sorted at every depth, so arg order can't defeat the repetition check. */
const stableStringify = (value: unknown): string =>
	JSON.stringify(value, (_key, val: unknown) =>
		val && typeof val === "object" && !Array.isArray(val)
			? Object.fromEntries(
					Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
				)
			: val
	) ?? "";

export async function runNestedAgent(
	spec: NestedAgentSpec,
	ctx: BuiltinToolContext,
	deps: NestedAgentDeps
): Promise<BuiltinToolResult> {
	const allowedBuiltins = deps.hostBuiltinTools.filter((tool) => spec.allowedTools.has(tool.name));
	const builtinNames = new Set(allowedBuiltins.map((tool) => tool.name));
	// Builtins run in this process, so provenance is not a question for them.
	const serversByName = new Map(deps.servers.map((server) => [server.name, server]));
	const fromAllowedServer = (fnName: string): boolean => {
		if (!spec.requireToolServer) return true;
		const server = serversByName.get(deps.mapping[fnName]?.server ?? "");
		return server ? spec.requireToolServer(server) : false;
	};
	const nestedTools: OpenAiTool[] = [
		...allowedBuiltins.map((tool) => tool.definition),
		...deps.mcpTools.filter(
			(tool) =>
				spec.allowedTools.has(tool.function.name) &&
				!builtinNames.has(tool.function.name) &&
				fromAllowedServer(tool.function.name)
		),
	];
	if (nestedTools.length === 0) return { error: spec.failure.noTools };
	const availableNames = new Set(nestedTools.map((tool) => tool.function.name));

	let messages: ChatCompletionMessageParam[] = [
		{ role: "system", content: spec.systemPrompt },
		{ role: "user", content: spec.task },
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
	// leave no room to work at all.
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
			total: spec.maxIterations,
			message,
		});
	};

	// A throttle or a brief router outage mid-run must not discard the
	// iterations already spent; the run is minutes long anyway, so it absorbs
	// the backoff itself. Only when the schedule runs out does the error
	// surface — with instructions to wait, so the model reaches for the wait
	// tool instead of hammering the sub-agent again.
	const completeWithRetry = (withTools: boolean, iteration: number) =>
		withUpstreamRetry(() => complete(withTools), {
			signal: ctx.abortSignal,
			onBackoff: (attempt, delayMs, err) => {
				logger.warn(
					{ attempt, delayMs, iteration, err: String(err) },
					`[${spec.label}] upstream failure; backing off in-loop`
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
			const response = await completeWithRetry(false, spec.maxIterations);
			const content = response.choices[0]?.message?.content ?? "";
			return content ? { resultText: content } : { error: failureText };
		} catch (err) {
			logger.warn({ err: String(err) }, `[${spec.label}] forced summary call failed`);
			return { error: failureText };
		}
	};

	let totalTokens = 0;
	let warned = false;
	const callCounts = new Map<string, number>();
	let repetitionNudged = false;
	let lengthCutRetries = 0;

	emitProgress(0, spec.progress.start);

	for (let iteration = 0; iteration < spec.maxIterations; iteration += 1) {
		if (ctx.abortSignal?.aborted) return { error: "Aborted by user" };

		if (totalTokens >= contextMaxAt) {
			logger.warn(
				{ totalTokens, iteration },
				`[${spec.label}] context max reached; forcing summary`
			);
			emitProgress(iteration, "Context limit reached — wrapping up");
			return forcedSummary(spec.stop.contextMax, spec.failure.contextMax);
		}
		if (!warned && totalTokens >= contextWarnAt) {
			warned = true;
			messages = [...messages, { role: "user", content: spec.stop.contextWarn }];
		}

		let response: Awaited<ReturnType<typeof complete>>;
		try {
			response = await completeWithRetry(true, iteration);
		} catch (err) {
			if (ctx.abortSignal?.aborted) return { error: "Aborted by user" };
			const message = err instanceof Error ? err.message : String(err);
			logger.warn({ err: message, iteration }, `[${spec.label}] sub-agent LLM call failed`);
			if (isRateLimitError(err)) return { error: spec.failure.rateLimited };
			return { error: `${spec.displayName} agent LLM error: ${message}` };
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
			if (finishReason === "length" && lengthCutRetries < MAX_LENGTH_CUT_RETRIES) {
				lengthCutRetries += 1;
				logger.warn(
					{ iteration, attempt: lengthCutRetries },
					`[${spec.label}] response cut by the output limit; nudging to finish`
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
			emitProgress(iteration + 1, spec.progress.done);
			return content ? { resultText: content } : { error: spec.failure.noSummary };
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
				// Same guard as the parent loop: an unparseable payload echoed back
				// 400s every later request of the run. See withParseableArguments.
				tool_calls: withParseableArguments(toolCalls),
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
					content: `Tool '${name}' not available for ${spec.label}.`,
				});
				continue;
			}
			const rawArguments = call.function?.arguments ?? "";
			const key = `${name}|${stableStringify(parseToolArguments(rawArguments) ?? rawArguments)}`;
			const count = (callCounts.get(key) ?? 0) + 1;
			callCounts.set(key, count);
			if (count >= REPETITION_THRESHOLD) sawRepetition = true;
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
				// conversation. Progress is reported on the parent call itself.
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
					? { ...message, content: spec.truncateOutput(message.content) }
					: message
			),
		];

		if (sawRepetition && !repetitionNudged) {
			repetitionNudged = true;
			logger.warn({ iteration }, `[${spec.label}] repetition guard activated`);
			messages = [...messages, { role: "user", content: spec.stop.repetition }];
		}
	}

	logger.warn({}, `[${spec.label}] iteration limit reached; extracting summary`);
	emitProgress(spec.maxIterations, "Iteration limit reached — extracting summary");
	return forcedSummary(spec.stop.iterationLimit, spec.failure.iterationLimit);
}
