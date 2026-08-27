import { config } from "$lib/server/config";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import { getMcpServers } from "$lib/server/mcp/registry";
import { isValidUrl } from "$lib/server/urlSafety";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { buildToolPreprompt } from "../utils/toolPrompt";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { resolveRouterTarget } from "./routerResolution";
import { executeToolCalls, type NormalizedToolCall } from "./toolInvocation";
import { hasTruncatedToolCall, parseToolArguments } from "./toolArgs";
import type { TextGenerationContext } from "../types";
import {
	hasAuthHeader,
	isStrictHfMcpLogin,
	hasNonEmptyToken,
	isExaMcpServer,
} from "$lib/server/mcp/hf";
import { buildImageRefResolver } from "./fileRefs";
import { prepareMessagesWithFiles } from "$lib/server/textGeneration/utils/prepareFiles";
import { makeImageProcessor } from "$lib/server/endpoints/images";
import { logger } from "$lib/server/logger";
import { AbortedGenerations } from "$lib/server/abortedGenerations";
import { withoutContentLength } from "$lib/server/undiciCompat";
import { isMlAssistantConversation, withMlAssistantServers } from "$lib/server/mlAssistant";
import { ML_ASSISTANT_MIN_COMPLETION_TOKENS } from "$lib/constants/mlAssistant";
import { withRateLimitRetry } from "../utils/rateLimitRetry";
import { getEnabledBuiltinTools, isResearchTool, shouldSkipMcpFlow } from "../builtinTools";
import { injectPlanState, PLAN_TOOL_NAME } from "../builtinTools/planTool";

export type RunMcpFlowContext = Pick<
	TextGenerationContext,
	| "model"
	| "conv"
	| "assistant"
	| "forceMultimodal"
	| "forceTools"
	| "provider"
	| "reasoningEffort"
	| "reasoningOverride"
	| "locals"
	| "generationId"
	| "messageId"
> & { messages: EndpointMessage[] };

// Only "not_applicable" means MCP never ran and the caller should generate normally.
// Every other result has already emitted its own final answer.
export type McpFlowResult =
	| "completed"
	| "not_applicable"
	| "aborted"
	| "exhausted"
	/** A 2026-era prompt is open; the run ends here and resumes when it is answered. */
	| "awaiting_input";

const MAX_TOOL_ROUNDS = 10;

// ML Assistant runs jobs, and the round budget is what it spends grounding ids,
// auditing a dataset, reading a working example and then submitting: ten does not
// survive one training task, and exhausting the budget ends the turn with an
// apology instead of an answer. Only the preset gets the larger budget — an
// ordinary conversation that loops is still stopped early.
const ML_ASSISTANT_MAX_TOOL_ROUNDS = 100;

// Each retry costs a tool round, so give up quickly and answer without the tool.
const MAX_TRUNCATED_TOOL_CALL_RETRIES = 2;

// One more attempt after a final answer ends before any visible content —
// cut by the output limit, or a stream that died mid-<think> with no "length"
// signal. If the nudged retry is cut too, the budget is simply too small for
// this answer and retrying again just burns rounds — finalize what exists,
// marked interrupted.
const MAX_CUT_ANSWER_RETRIES = 1;

export async function* runMcpFlow({
	model,
	conv,
	messages,
	assistant,
	forceMultimodal,
	forceTools,
	provider,
	reasoningEffort,
	reasoningOverride,
	locals,
	generationId,
	messageId,
	preprompt,
	abortSignal,
	abortController,
	promptedAt,
}: RunMcpFlowContext & {
	preprompt?: string;
	abortSignal?: AbortSignal;
	abortController?: AbortController;
	promptedAt?: Date;
}): AsyncGenerator<MessageUpdate, McpFlowResult, undefined> {
	// Helper to check if generation should be aborted via DB polling
	// Also triggers the abort controller to cancel active streams/requests
	const checkAborted = (): boolean => {
		if (abortSignal?.aborted) return true;
		const abortTime = AbortedGenerations.getInstance().getAbortTime(conv._id.toString());
		if (abortTime && promptedAt && abortTime > promptedAt) {
			// Trigger the abort controller to cancel active streams
			if (abortController && !abortController.signal.aborted) {
				abortController.abort();
			}
			return true;
		}
		return false;
	};
	const builtinTools = getEnabledBuiltinTools({ conv });
	// Read once: the preset decides the servers, the round budget and which tool
	// doctrine is sent, and they must all agree within a run.
	const mlAssistant = isMlAssistantConversation(conv);

	// Start from env-configured servers
	let servers = getMcpServers();
	try {
		logger.debug(
			{ baseServers: servers.map((s) => ({ name: s.name, url: s.url })), count: servers.length },
			"[mcp] base servers loaded"
		);
	} catch {}

	// Merge in request-provided custom servers (if any)
	try {
		const reqMcp = (
			locals as unknown as {
				mcp?: {
					selectedServers?: Array<{ name: string; url: string; headers?: Record<string, string> }>;
					selectedServerNames?: string[];
				};
			}
		)?.mcp;
		const custom = Array.isArray(reqMcp?.selectedServers) ? reqMcp?.selectedServers : [];
		if (custom.length > 0) {
			// Deduplicate by server name (request takes precedence)
			const byName = new Map<
				string,
				{ name: string; url: string; headers?: Record<string, string> }
			>();
			for (const s of servers) byName.set(s.name, s);
			for (const s of custom) byName.set(s.name, s);
			servers = [...byName.values()];
			try {
				logger.debug(
					{
						customProvidedCount: custom.length,
						mergedServers: servers.map((s) => ({
							name: s.name,
							url: s.url,
							hasAuth: !!s.headers?.Authorization,
						})),
					},
					"[mcp] merged request-provided servers"
				);
			} catch {}
		}

		// If the client specified a selection by name, filter to those
		const names = Array.isArray(reqMcp?.selectedServerNames)
			? reqMcp?.selectedServerNames
			: undefined;
		if (Array.isArray(names)) {
			const before = servers.map((s) => s.name);
			servers = servers.filter((s) => names.includes(s.name));
			try {
				logger.debug(
					{ selectedNames: names, before, after: servers.map((s) => s.name) },
					"[mcp] applied name selection"
				);
			} catch {}
		}
	} catch {
		// ignore selection merge errors and proceed with env servers
	}

	// The preset's servers go on after the user's selection has been filtered, so
	// they survive a selection that excludes them. Anything the user picked on top
	// still comes through — extra servers are configurable, these are not.
	if (mlAssistant) {
		servers = withMlAssistantServers(servers);
		try {
			logger.debug(
				{ servers: servers.map((s) => s.name) },
				"[mcp] applied ML Assistant preset servers"
			);
		} catch {}
	}

	// If selection/merge yielded no servers, bail early with clearer log
	if (shouldSkipMcpFlow(servers.length, builtinTools.length)) {
		logger.warn({}, "[mcp] no MCP servers selected after merge/name filter, and no builtin tools");
		return "not_applicable";
	}

	// Enforce server-side safety (public HTTPS only, no private ranges by default)
	{
		const before = servers.slice();
		servers = servers.filter((s) => {
			try {
				return isValidUrl(s.url, { allowInsecure: true });
			} catch {
				return false;
			}
		});
		try {
			const rejected = before.filter((b) => !servers.includes(b));
			if (rejected.length > 0) {
				logger.warn(
					{ rejected: rejected.map((r) => ({ name: r.name, url: r.url })) },
					"[mcp] rejected servers by URL safety"
				);
			}
		} catch {}
	}
	if (shouldSkipMcpFlow(servers.length, builtinTools.length)) {
		logger.warn({}, "[mcp] all selected MCP servers rejected by URL safety guard");
		return "not_applicable";
	}

	// Optionally attach the logged-in user's HF token to the official HF MCP server only.
	// Never override an explicit Authorization header, and require token to look like an HF token.
	try {
		const shouldForward = config.MCP_FORWARD_HF_USER_TOKEN === "true";
		const userToken =
			(locals as unknown as { hfAccessToken?: string } | undefined)?.hfAccessToken ??
			(locals as unknown as { token?: string } | undefined)?.token;

		if (shouldForward && hasNonEmptyToken(userToken)) {
			const overlayApplied: string[] = [];
			servers = servers.map((s) => {
				try {
					if (isStrictHfMcpLogin(s.url) && !hasAuthHeader(s.headers)) {
						overlayApplied.push(s.name);
						return {
							...s,
							headers: { ...(s.headers ?? {}), Authorization: `Bearer ${userToken}` },
						};
					}
				} catch {
					// ignore URL parse errors and leave server unchanged
				}
				return s;
			});
			if (overlayApplied.length > 0) {
				try {
					logger.debug({ overlayApplied }, "[mcp] forwarded HF token to servers");
				} catch {}
			}
		}
	} catch {
		// best-effort overlay; continue if anything goes wrong
	}

	// Inject Exa API key for mcp.exa.ai servers via URL param (mcp.exa.ai doesn't support headers)
	try {
		const exaApiKey = config.EXA_API_KEY;
		if (hasNonEmptyToken(exaApiKey)) {
			const overlayApplied: string[] = [];
			servers = servers.map((s) => {
				try {
					if (isExaMcpServer(s.url)) {
						const url = new URL(s.url);
						if (!url.searchParams.has("exaApiKey")) {
							url.searchParams.set("exaApiKey", exaApiKey);
							overlayApplied.push(s.name);
							return { ...s, url: url.toString() };
						}
					}
				} catch {}
				return s;
			});
			if (overlayApplied.length > 0) {
				logger.debug({ overlayApplied }, "[mcp] injected Exa API key to servers");
			}
		}
	} catch {
		// best-effort injection; continue if anything goes wrong
	}

	logger.debug(
		{ count: servers.length, servers: servers.map((s) => s.name) },
		"[mcp] servers configured"
	);
	if (shouldSkipMcpFlow(servers.length, builtinTools.length)) {
		return "not_applicable";
	}

	// Gate MCP flow based on model tool support (aggregated) with user override
	try {
		const supportsTools = Boolean((model as unknown as { supportsTools?: boolean }).supportsTools);
		const toolsEnabled = Boolean(forceTools) || supportsTools;
		logger.debug(
			{
				model: model.id ?? model.name,
				supportsTools,
				forceTools: Boolean(forceTools),
				toolsEnabled,
			},
			"[mcp] tools gate evaluation"
		);
		if (!toolsEnabled) {
			logger.info(
				{ model: model.id ?? model.name },
				"[mcp] tools disabled for model; skipping MCP flow"
			);
			return "not_applicable";
		}
	} catch {
		// If anything goes wrong reading the flag, proceed (previous behavior)
	}

	const resolveFileRef = buildImageRefResolver(messages);
	const imageProcessor = makeImageProcessor({
		supportedMimeTypes: ["image/png", "image/jpeg"],
		preferredMimeType: "image/jpeg",
		maxSizeInMB: 1,
		maxWidth: 1024,
		maxHeight: 1024,
	});

	const hasImageInput = messages.some((msg) =>
		(msg.files ?? []).some(
			(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
		)
	);

	const { runMcp, targetModel, candidateModelId, resolvedRoute } = await resolveRouterTarget({
		model,
		hasImageInput,
		locals,
	});

	if (!runMcp) {
		logger.info(
			{ model: targetModel.id ?? targetModel.name, resolvedRoute },
			"[mcp] runMcp=false (routing chose non-tools candidate)"
		);
		return "not_applicable";
	}

	// Declared outside the try so the catch can see it: whether the user has been shown
	// anything for this turn, which decides whether a failure is recoverable.
	let producedOutput = false;

	try {
		const { tools: mcpTools, mapping } = await getOpenAiToolsForMcp(servers, {
			signal: abortSignal,
		});
		// An MCP tool that collides with a builtin name is dropped: dispatch checks
		// builtins first, so the MCP twin would be advertised but unreachable.
		const builtinNames = new Set(builtinTools.map((tool) => tool.name));
		const collisions = mcpTools.filter((tool) => builtinNames.has(tool.function.name));
		if (collisions.length > 0) {
			logger.warn(
				{ dropped: collisions.map((tool) => tool.function.name) },
				"[mcp] dropped MCP tools shadowed by builtin tools"
			);
		}
		const oaTools = [
			...builtinTools.map((tool) => tool.definition),
			...mcpTools.filter((tool) => !builtinNames.has(tool.function.name)),
		];
		try {
			logger.info(
				{ toolCount: oaTools.length, toolNames: oaTools.map((t) => t.function.name) },
				"[mcp] openai tool defs built"
			);
		} catch {}
		if (oaTools.length === 0) {
			logger.warn({}, "[mcp] zero tools available after listing; skipping MCP flow");
			return "not_applicable";
		}

		const { OpenAI } = await import("openai");

		// Capture provider header (x-inference-provider) from the upstream OpenAI-compatible server.
		let providerHeader: string | undefined;
		const captureProviderFetch = async (
			input: RequestInfo | URL,
			init?: RequestInit
		): Promise<Response> => {
			const res = await fetch(input, withoutContentLength(init));
			const p = res.headers.get("x-inference-provider");
			if (p && !providerHeader) providerHeader = p;
			return res;
		};

		const openai = new OpenAI({
			apiKey: config.OPENAI_API_KEY || config.HF_TOKEN || "sk-",
			baseURL: config.OPENAI_BASE_URL,
			fetch: captureProviderFetch,
			defaultHeaders: {
				// Bill to organization if configured (HuggingChat only)
				...(config.isHuggingChat && locals?.billingOrganization
					? { "X-HF-Bill-To": locals.billingOrganization }
					: {}),
			},
		});

		const mmEnabled = (forceMultimodal ?? false) || targetModel.multimodal;
		logger.info(
			{
				targetModel: targetModel.id ?? targetModel.name,
				mmEnabled,
				route: resolvedRoute,
				candidateModelId,
				toolCount: oaTools.length,
				hasUserToken: Boolean((locals as unknown as { token?: string })?.token),
			},
			"[mcp] starting completion with tools"
		);
		// Whether this model may be sent reasoning_content at all: the per-user
		// override wins in both directions, else the model's policy decides — on
		// by default, off only for a blocklisted family (see reasoningPolicy.ts).
		//
		// Governs the in-loop echo below as well as cross-turn replay, because
		// emitting reasoning and accepting it back are different things: at least
		// one provider rejects the field outright rather than ignoring it.
		//
		//   HTTP 400 messages.2.assistant.reasoning_content: property
		//   'messages.2.assistant.reasoning_content' is unsupported
		//
		// Nothing is invented by defaulting on — reasoning is only echoed when
		// the model actually produced it, so a non-reasoning model is unaffected
		// either way.
		const mayEchoReasoning =
			reasoningOverride ??
			(targetModel as unknown as { preservesReasoning?: boolean }).preservesReasoning !== false;

		// Hoisted above the message prep so the history budget can reserve the
		// reply allowance this request will actually ask for.
		const parameters = { ...targetModel.parameters, ...assistant?.generateSettings } as Record<
			string,
			unknown
		>;
		const catalogMaxTokens =
			(parameters?.max_tokens as number | undefined) ??
			(parameters?.max_new_tokens as number | undefined) ??
			(parameters?.max_completion_tokens as number | undefined);
		const targetContextLength = (targetModel as unknown as { contextLength?: number })
			.contextLength;
		// The preset floors the reply allowance — see the constant for why. The
		// floor never claims more than half the model's window: prompt plus reply
		// must fit it, and a backend that enforces the sum would reject the very
		// first request of a small-window model. A catalog value above the floor
		// still wins. The research sub-agent inherits this through completionBase.
		const clampedFloor = targetContextLength
			? Math.min(ML_ASSISTANT_MIN_COMPLETION_TOKENS, Math.floor(targetContextLength / 2))
			: ML_ASSISTANT_MIN_COMPLETION_TOKENS;
		const maxTokens = mlAssistant
			? Math.max(catalogMaxTokens ?? 0, clampedFloor)
			: catalogMaxTokens;

		let messagesOpenAI: ChatCompletionMessageParam[] = await prepareMessagesWithFiles(
			messages,
			imageProcessor,
			mmEnabled,
			{
				replayToolHistory: true,
				attachReasoning: mayEchoReasoning,
				// The model resolved for THIS turn. Under the "omni" router alias a
				// prior turn in the same conversation can have been produced by a
				// different model (per-message routing, no user action needed); this
				// gates reasoning_content to only replay onto its own producer.
				currentProducerModel: candidateModelId ?? targetModel.id ?? targetModel.name,
				// The resolved target's window, not the router alias's: under "omni"
				// the alias itself has none, and the candidate is what serves this
				// request. Tool schemas are prepended after this returns, which is
				// part of what CONTEXT_RESERVE_TOKENS holds back.
				contextLengthTokens: targetContextLength,
				maxOutputTokens: maxTokens,
			}
		);
		const userTimezone = (locals as unknown as { timezone?: string })?.timezone;
		// In the mode the doctrine paragraphs are swapped, not appended to: the
		// generic restraint rule tells the model not to reach for a tool unless it
		// lacks a capability, and names writing code as a case to answer directly,
		// which is the inverse of the preset's doctrine.
		const toolPreprompt = buildToolPreprompt(oaTools, userTimezone, builtinTools, {
			mlAssistant,
		});
		const prepromptPieces: string[] = [];
		if (toolPreprompt.trim().length > 0) {
			prepromptPieces.push(toolPreprompt);
		}
		if (typeof preprompt === "string" && preprompt.trim().length > 0) {
			prepromptPieces.push(preprompt);
		}
		const mergedPreprompt = prepromptPieces.join("\n\n");
		const hasSystemMessage = messagesOpenAI.length > 0 && messagesOpenAI[0]?.role === "system";
		if (hasSystemMessage) {
			if (mergedPreprompt.length > 0) {
				const existing = messagesOpenAI[0].content ?? "";
				const existingText = typeof existing === "string" ? existing : "";
				messagesOpenAI[0].content = mergedPreprompt + (existingText ? "\n\n" + existingText : "");
			}
		} else if (mergedPreprompt.length > 0) {
			messagesOpenAI = [{ role: "system", content: mergedPreprompt }, ...messagesOpenAI];
		}

		// Tail-injected once per turn; within the turn, freshness travels in the tool
		// results. Gated on the tool being offered so a stale plan can't tell the model
		// to call a tool it doesn't have.
		if (conv.plan && builtinTools.some((tool) => tool.name === PLAN_TOOL_NAME)) {
			messagesOpenAI = injectPlanState(messagesOpenAI, conv.plan);
		}

		// Work around servers that reject `system` role
		if (
			typeof config.OPENAI_BASE_URL === "string" &&
			config.OPENAI_BASE_URL.length > 0 &&
			(config.OPENAI_BASE_URL.includes("hf.space") ||
				config.OPENAI_BASE_URL.includes("gradio.app")) &&
			messagesOpenAI[0]?.role === "system"
		) {
			messagesOpenAI[0] = { ...messagesOpenAI[0], role: "user" };
		}

		const stopSequences =
			typeof parameters?.stop === "string"
				? parameters.stop
				: Array.isArray(parameters?.stop)
					? (parameters.stop as string[])
					: undefined;

		// Build model ID with optional provider suffix (e.g., "model:fastest" or "model:together")
		const baseModelId = targetModel.id ?? targetModel.name;
		const modelIdWithProvider =
			provider && provider !== "auto" ? `${baseModelId}:${provider}` : baseModelId;

		const completionBase: Omit<ChatCompletionCreateParamsStreaming, "messages"> & {
			reasoning_effort?: "low" | "medium" | "high";
		} = {
			model: modelIdWithProvider,
			stream: true,
			temperature: typeof parameters?.temperature === "number" ? parameters.temperature : undefined,
			top_p: typeof parameters?.top_p === "number" ? parameters.top_p : undefined,
			frequency_penalty:
				typeof parameters?.frequency_penalty === "number"
					? parameters.frequency_penalty
					: typeof parameters?.repetition_penalty === "number"
						? parameters.repetition_penalty
						: undefined,
			presence_penalty:
				typeof parameters?.presence_penalty === "number" ? parameters.presence_penalty : undefined,
			stop: stopSequences,
			max_tokens: typeof maxTokens === "number" ? maxTokens : undefined,
			tools: oaTools,
			tool_choice: "auto",
			...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
		};

		// The research builtin runs a nested tool loop and needs the request
		// plumbing this turn resolved — client, sampling params, the listed
		// MCP tools — which only exists here. Its definition and enablement
		// stayed in builtinTools/; only the runtime binding lives at the
		// call site.
		builtinTools.find(isResearchTool)?.bind({
			openai,
			completionBase,
			requestHeaders: {
				"ChatUI-Conversation-ID": conv._id.toString(),
				"X-use-cache": "false",
				...(config.USE_USER_TOKEN === "true" && locals?.token
					? { Authorization: `Bearer ${locals.token}` }
					: {}),
			},
			servers,
			mapping,
			mcpTools,
			hostBuiltinTools: builtinTools,
			contextLengthTokens: targetContextLength,
		});

		const toPrimitive = (value: unknown) => {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				return value;
			}
			return undefined;
		};

		const parseArgs = parseToolArguments;

		const processToolOutput = (
			text: string
		): {
			annotated: string;
			sources: { index: number; link: string }[];
		} => ({ annotated: text, sources: [] });

		const maxToolRounds = mlAssistant ? ML_ASSISTANT_MAX_TOOL_ROUNDS : MAX_TOOL_ROUNDS;

		let lastAssistantContent = "";
		let streamedContent = false;
		// Track whether we're inside a <think> block when the upstream streams
		// provider-specific reasoning tokens (e.g. `reasoning` or `reasoning_content`).
		let thinkOpen = false;
		// Leading whitespace-only reasoning deltas that arrived before the block
		// opened (thinkOpen still false, so a blank chunk wouldn't otherwise open
		// one). Held here and flushed once a non-blank delta opens the block, so
		// the persisted trace stays byte-exact instead of silently dropping them.
		let pendingReasoningWhitespace = "";
		let truncatedToolCallRetries = 0;
		let cutAnswerRetries = 0;

		if (resolvedRoute && candidateModelId) {
			yield {
				type: MessageUpdateType.RouterMetadata,
				route: resolvedRoute,
				model: candidateModelId,
			};
			logger.debug(
				{ route: resolvedRoute, model: candidateModelId },
				"[mcp] router metadata emitted"
			);
		}

		for (let loop = 0; loop < maxToolRounds; loop += 1) {
			// Check for abort at the start of each loop iteration
			if (checkAborted()) {
				logger.info({ loop }, "[mcp] aborting at start of loop iteration");
				return "aborted";
			}

			lastAssistantContent = "";
			streamedContent = false;
			// Discard any whitespace-only reasoning buffered but never flushed by a
			// non-blank delta last round — it never became part of a real trace.
			pendingReasoningWhitespace = "";

			const completionRequest: ChatCompletionCreateParamsStreaming = {
				...completionBase,
				messages: messagesOpenAI,
			};

			// A turn several productive rounds deep must not die on one throttled
			// request; absorb router 429s that outlast the SDK's quick retries.
			const completionStream: Stream<ChatCompletionChunk> = await withRateLimitRetry(
				() =>
					openai.chat.completions.create(completionRequest, {
						signal: abortSignal,
						headers: {
							"ChatUI-Conversation-ID": conv._id.toString(),
							"X-use-cache": "false",
							...(config.USE_USER_TOKEN === "true" && locals?.token
								? { Authorization: `Bearer ${locals.token}` }
								: {}),
						},
					}),
				{
					signal: abortSignal,
					onBackoff: (attempt, delayMs) =>
						logger.warn({ loop, attempt, delayMs }, "[mcp] rate limited; backing off in-loop"),
				}
			);

			// If provider header was exposed, notify UI so it can render "via {provider}".
			if (providerHeader) {
				yield {
					type: MessageUpdateType.RouterMetadata,
					route: "",
					model: "",
					provider: providerHeader as unknown as import("@huggingface/inference").InferenceProvider,
				};
				logger.debug({ provider: providerHeader }, "[mcp] provider metadata emitted");
			}

			const toolCallState: Record<number, { id?: string; name?: string; arguments: string }> = {};
			let firstToolDeltaLogged = false;
			let sawToolCall = false;
			let tokenCount = 0;
			let finishReason: string | null | undefined;
			for await (const chunk of completionStream) {
				const choice = chunk.choices?.[0];
				// Before the delta guard: the terminal chunk can carry only a finish_reason.
				if (choice?.finish_reason) finishReason = choice.finish_reason;
				const delta = choice?.delta;
				if (!delta) continue;

				const chunkToolCalls = delta.tool_calls ?? [];
				if (chunkToolCalls.length > 0) {
					sawToolCall = true;
					for (const call of chunkToolCalls) {
						const toolCall = call as unknown as {
							index?: number;
							id?: string;
							function?: { name?: string; arguments?: string };
						};
						const index = toolCall.index ?? 0;
						const current = toolCallState[index] ?? { arguments: "" };
						if (toolCall.id) current.id = toolCall.id;
						if (toolCall.function?.name) current.name = toolCall.function.name;
						if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
						toolCallState[index] = current;
					}
					if (!firstToolDeltaLogged) {
						try {
							const first =
								toolCallState[
									Object.keys(toolCallState)
										.map((k) => Number(k))
										.sort((a, b) => a - b)[0] ?? 0
								];
							logger.info(
								{ firstCallName: first?.name, hasId: Boolean(first?.id) },
								"[mcp] observed streamed tool_call delta"
							);
							firstToolDeltaLogged = true;
						} catch {}
					}
				}

				const deltaContent = (() => {
					if (typeof delta.content === "string") return delta.content;
					const maybeParts = delta.content as unknown;
					if (Array.isArray(maybeParts)) {
						return maybeParts
							.map((part) =>
								typeof part === "object" &&
								part !== null &&
								"text" in part &&
								typeof (part as Record<string, unknown>).text === "string"
									? String((part as Record<string, unknown>).text)
									: ""
							)
							.join("");
					}
					return "";
				})();

				// Provider-dependent reasoning fields (`reasoning`, `reasoning_content`,
				// or `reasoning_text`).
				const deltaFields = delta as unknown as {
					reasoning?: unknown;
					reasoning_content?: unknown;
					reasoning_text?: unknown;
				};
				const deltaReasoning: string =
					typeof deltaFields?.reasoning === "string"
						? deltaFields.reasoning
						: typeof deltaFields?.reasoning_content === "string"
							? deltaFields.reasoning_content
							: typeof deltaFields?.reasoning_text === "string"
								? deltaFields.reasoning_text
								: "";

				// Merge reasoning + content into a single combined token stream, mirroring
				// the OpenAI adapter so the UI can auto-detect <think> blocks.
				let combined = "";
				// Whitespace-only deltas still count once a think block is open
				// (paragraph breaks are part of the byte-exact trace); non-blank
				// text is only required to OPEN a block, so stray leading
				// whitespace can't create empty think blocks on its own — but it
				// must not be discarded either, so it's buffered until a non-blank
				// delta arrives and flushed into the opening of the block.
				if (deltaReasoning.length > 0) {
					if (thinkOpen) {
						combined += deltaReasoning;
					} else if (deltaReasoning.trim().length > 0) {
						combined += "<think>" + pendingReasoningWhitespace + deltaReasoning;
						pendingReasoningWhitespace = "";
						thinkOpen = true;
					} else {
						pendingReasoningWhitespace += deltaReasoning;
					}
				}

				if (deltaContent && deltaContent.length > 0) {
					if (thinkOpen) {
						combined += "</think>" + deltaContent;
						thinkOpen = false;
					} else {
						combined += deltaContent;
					}
				}

				if (combined.length > 0) {
					lastAssistantContent += combined;
					if (!sawToolCall) {
						streamedContent = true;
						producedOutput = true;
						yield { type: MessageUpdateType.Stream, token: combined };
						tokenCount += combined.length;
					}
				}

				// Periodic abort check during streaming
				if (checkAborted()) {
					logger.info({ loop, tokenCount }, "[mcp] aborting during stream");
					return "aborted";
				}
			}
			logger.info(
				{ sawToolCalls: Object.keys(toolCallState).length > 0, tokens: tokenCount, loop },
				"[mcp] completion stream closed"
			);

			// Check abort after stream completes
			if (checkAborted()) {
				logger.info({ loop }, "[mcp] aborting after stream completed");
				return "aborted";
			}

			// Auto-close any unclosed <think> block so reasoning from this loop
			// doesn't swallow content from subsequent iterations.  The client-side
			// regex matches `<think>` to end-of-string, so an unclosed block would
			// hide everything that follows.
			if (thinkOpen) {
				if (streamedContent) {
					yield { type: MessageUpdateType.Stream, token: "</think>" };
				}
				lastAssistantContent += "</think>";
				thinkOpen = false;
			}

			let discardedTruncatedToolCalls = false;
			if (hasTruncatedToolCall(finishReason, Object.values(toolCallState))) {
				if (truncatedToolCallRetries < MAX_TRUNCATED_TOOL_CALL_RETRIES) {
					truncatedToolCallRetries += 1;
					logger.warn(
						{ loop, attempt: truncatedToolCallRetries },
						"[mcp] tool call truncated by the output limit; retrying"
					);
					const visibleContent = lastAssistantContent
						.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "")
						.trim();
					messagesOpenAI = [
						...messagesOpenAI,
						// Not optional: a tool-only response leaves no visible content, and
						// without this turn the nudge below is a second consecutive user
						// message, which providers enforcing alternating roles reject —
						// failing the very retry meant to recover the call.
						{
							role: "assistant" as const,
							content: visibleContent || "(Tool call cut off by the output limit.)",
						},
						{
							role: "user" as const,
							content:
								"[SYSTEM: Your previous response hit the output limit before the tool call was complete, so it was discarded. Retry with a smaller tool call — split large payloads across several calls and keep any inline file content short.]",
						},
					];
					continue;
				}
				discardedTruncatedToolCalls = true;
				logger.warn({ loop }, "[mcp] tool call truncated repeatedly; answering without running it");
			}

			if (!discardedTruncatedToolCalls && Object.keys(toolCallState).length > 0) {
				// If any streamed call is missing id, perform a quick non-stream retry to recover full tool_calls with ids
				const missingId = Object.values(toolCallState).some((c) => c?.name && !c?.id);
				let calls: NormalizedToolCall[];
				if (missingId) {
					logger.debug(
						{ loop },
						"[mcp] missing tool_call id in stream; retrying non-stream to recover ids"
					);
					// Same throttle absorption as the streaming call above: this recovery
					// request is mid-round, where a surfaced 429 costs the whole turn.
					const nonStream = await withRateLimitRetry(
						() =>
							openai.chat.completions.create(
								{ ...completionBase, messages: messagesOpenAI, stream: false },
								{
									signal: abortSignal,
									headers: {
										"ChatUI-Conversation-ID": conv._id.toString(),
										"X-use-cache": "false",
										...(config.USE_USER_TOKEN === "true" && locals?.token
											? { Authorization: `Bearer ${locals.token}` }
											: {}),
									},
								}
							),
						{
							signal: abortSignal,
							onBackoff: (attempt, delayMs) =>
								logger.warn(
									{ loop, attempt, delayMs },
									"[mcp] rate limited on id recovery; backing off in-loop"
								),
						}
					);
					const tc = nonStream.choices?.[0]?.message?.tool_calls ?? [];
					calls = tc.map((t) => ({
						id: t.id,
						name: t.function?.name ?? "",
						arguments: t.function?.arguments ?? "",
					}));
				} else {
					calls = Object.values(toolCallState)
						.map((c) => (c?.id && c?.name ? c : undefined))
						.filter(Boolean)
						.map((c) => ({
							id: c?.id ?? "",
							name: c?.name ?? "",
							arguments: c?.arguments ?? "",
						})) as NormalizedToolCall[];
				}

				// Include the assistant message with tool_calls so the next round
				// sees both the calls and their outputs, matching MCP branch behavior.
				const toolCalls: ChatCompletionMessageToolCall[] = calls.map((call) => ({
					id: call.id,
					type: "function",
					function: { name: call.name, arguments: call.arguments },
				}));

				// Move <think> content out of `content` and echo it back as
				// `reasoning_content`: preserved-thinking models (e.g. Kimi K2/K3)
				// condition their next tool round on prior reasoning and degrade
				// when it's dropped; other providers ignore the field.
				const thinkParts: string[] = [];
				const assistantContentForToolMsg = lastAssistantContent.replace(
					/<think>([\s\S]*?)(?:<\/think>|$)/g,
					(_match, inner: string) => {
						thinkParts.push(inner);
						return "";
					}
				);
				// Trim only to TEST for emptiness — the joined value itself must stay
				// byte-exact once it's echoed back and persisted: vendors documenting
				// preserved thinking (e.g. Z.ai's "must return the complete,
				// unmodified reasoning_content") can condition on or cache against the
				// exact bytes, so stripping whitespace here would send a corrupted
				// trace on the next round/turn.
				const reasoningForToolMsg = thinkParts.join("\n");
				// Omit `content` entirely when nothing visible remains — some
				// OpenAI-compatible backends 400 on empty text next to tool_calls.
				const assistantToolMessage: ChatCompletionMessageParam & { reasoning_content?: string } = {
					role: "assistant",
					tool_calls: toolCalls,
					...(assistantContentForToolMsg.trim().length > 0
						? { content: assistantContentForToolMsg }
						: {}),
					// Gated by mayEchoReasoning — see where it is defined. Still
					// persisted below regardless of the gate: recording what the model
					// thought is inert, and only sending it can break a request.
					...(mayEchoReasoning && reasoningForToolMsg.trim().length > 0
						? { reasoning_content: reasoningForToolMsg }
						: {}),
				};

				const exec = executeToolCalls({
					calls,
					mapping,
					servers,
					parseArgs,
					resolveFileRef,
					toPrimitive,
					processToolOutput,
					abortSignal,
					// Persisted on the round's first Call update so history replay
					// can re-attach this round's reasoning and preamble text to its
					// own message instead of moving them onto the final answer.
					roundReasoning: reasoningForToolMsg,
					roundContent: assistantContentForToolMsg,
					elicitation: { conversationId: conv._id, generationId, messageId },
					// A parked call resumes with no request behind it, so the identity it
					// should act as has to be recorded now, while there still is one.
					owner: {
						userId: (locals as unknown as { user?: { _id?: import("mongodb").ObjectId } })?.user
							?._id,
						sessionId: (locals as unknown as { sessionId?: string })?.sessionId,
					},
					builtinTools,
				});
				let toolMsgCount = 0;
				let toolRunCount = 0;
				for await (const event of exec) {
					if (event.type === "update") {
						producedOutput = true;
						yield event.update;
					} else {
						if (event.summary.awaitingInput) {
							logger.info({ loop }, "[mcp] parked on a durable prompt; run ends until answered");
							return "awaiting_input";
						}
						messagesOpenAI = [
							...messagesOpenAI,
							assistantToolMessage,
							...(event.summary.toolMessages ?? []),
						];
						toolMsgCount = event.summary.toolMessages?.length ?? 0;
						toolRunCount = event.summary.toolRuns?.length ?? 0;
						logger.info(
							{ toolMsgCount, toolRunCount },
							"[mcp] tools executed; continuing loop for follow-up completion"
						);
					}

					// Check abort during tool execution
					if (checkAborted()) {
						logger.info({ loop, toolMsgCount }, "[mcp] aborting during tool execution");
						return "aborted";
					}
				}

				// Check abort after all tools complete before continuing loop
				if (checkAborted()) {
					logger.info({ loop }, "[mcp] aborting after tool execution");
					return "aborted";
				}
				// Continue loop: next iteration will use tool messages to get the final content
				continue;
			}

			// No tool calls: finalize and return
			// If a <think> block is still open, close it for the final output
			if (thinkOpen) {
				lastAssistantContent += "</think>";
				thinkOpen = false;
			}
			// A response cut by the output limit is not an answer. With a reasoning
			// model it usually ends inside the <think> block, so finalizing it
			// reports a half-thought as a finished turn. The same failure arrives
			// without the "length" signal when the stream dies mid-think, so a
			// think-only response counts as cut regardless of finish_reason. Retry
			// once, telling the model to answer with its remaining budget; a second
			// cut finalizes as interrupted rather than pretending completion.
			const visibleContent = lastAssistantContent
				.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "")
				.trim();
			const thinkOnlyAnswer = visibleContent.length === 0 && lastAssistantContent.trim().length > 0;
			const cutMidAnswer =
				(finishReason === "length" || thinkOnlyAnswer) && !discardedTruncatedToolCalls;
			if (cutMidAnswer && cutAnswerRetries < MAX_CUT_ANSWER_RETRIES) {
				cutAnswerRetries += 1;
				logger.warn(
					{ loop, attempt: cutAnswerRetries, finishReason, thinkOnlyAnswer },
					"[mcp] response ended before a visible answer; retrying"
				);
				messagesOpenAI = [
					...messagesOpenAI,
					{
						role: "assistant" as const,
						content: visibleContent || "(Response ended mid-reasoning, before a visible answer.)",
					},
					{
						role: "user" as const,
						content:
							finishReason === "length"
								? "[SYSTEM: Your previous response hit the output limit before it finished — most of it was internal reasoning. Give your final answer now, with minimal further reasoning and the answer itself kept concise.]"
								: "[SYSTEM: Your previous response ended while still inside internal reasoning, so no visible answer was produced. Give your final answer now, with minimal further reasoning and the answer itself kept concise.]",
					},
				];
				continue;
			}
			// Without this the turn finalizes empty and the route reports a bare
			// "No output was generated" instead of what actually happened.
			if (discardedTruncatedToolCalls && lastAssistantContent.trim().length === 0) {
				lastAssistantContent =
					"I couldn't complete that tool call — the request kept exceeding the output limit. Try breaking it into smaller steps.";
			}
			if (!streamedContent && lastAssistantContent.trim().length > 0) {
				yield { type: MessageUpdateType.Stream, token: lastAssistantContent };
			}
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: lastAssistantContent,
				interrupted: cutMidAnswer,
			};
			logger.info(
				{ length: lastAssistantContent.length, loop },
				"[mcp] final answer emitted (no tool_calls)"
			);
			return "completed";
		}
		// Not "not_applicable": that re-runs the turn with no tools and discards every
		// tool result this turn produced.
		logger.warn({ maxRounds: maxToolRounds }, "[mcp] tool-round budget exhausted");
		const exhaustedText =
			lastAssistantContent.trim().length > 0
				? lastAssistantContent
				: "I stopped after too many tool steps without reaching an answer. Try narrowing the request or breaking it into smaller ones.";
		if (!streamedContent) {
			yield { type: MessageUpdateType.Stream, token: exhaustedText };
		}
		yield { type: MessageUpdateType.FinalAnswer, text: exhaustedText, interrupted: false };
		return "exhausted";
	} catch (err) {
		const msg = String(err ?? "");
		const isAbort =
			(abortSignal && abortSignal.aborted) ||
			msg.includes("AbortError") ||
			msg.includes("APIUserAbortError") ||
			msg.includes("Request was aborted");
		if (isAbort) {
			// Expected on user stop; keep logs quiet and do not treat as error
			logger.debug({}, "[mcp] aborted by user");
			return "aborted";
		}
		// Swallowing this into "not_applicable" would tell the caller MCP never ran, and
		// it would answer the question again with no tools — discarding the tool work
		// already streamed to the user. Only a failure before anything was shown is
		// recoverable that way.
		if (producedOutput) throw err;
		logger.warn({ err: msg }, "[mcp] flow failed before any output; falling back");
	}
	// Note: pooled MCP clients are shared across concurrent requests, so they must NOT be
	// closed here — that rejects other turns' in-flight tool calls with "-32000 Connection
	// closed". Idle clients are reclaimed by the pool's sweeper instead (see clientPool.ts).

	return "not_applicable";
}
