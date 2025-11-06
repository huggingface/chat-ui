import { config } from "$lib/server/config";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { getMcpServers } from "$lib/server/mcp/registry";
import { resetMcpToolsCache } from "$lib/server/mcp/tools";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
	ChatCompletionContentPart,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { buildToolPreprompt } from "../utils/toolPrompt";
import { resolveRouterTarget } from "./routerResolution";
import { executeToolCalls, type NormalizedToolCall } from "./toolInvocation";
import { drainPool } from "$lib/server/mcp/clientPool";
import { logger } from "../../logger";
import type { TextGenerationContext } from "../types";

export type RunMcpFlowContext = Pick<
	TextGenerationContext,
	"model" | "conv" | "assistant" | "forceMultimodal" | "locals"
> & { messages: EndpointMessage[] };

export async function* runMcpFlow({
	model,
	conv,
	messages,
	assistant,
	forceMultimodal,
	locals,
	preprompt,
	abortSignal,
}: RunMcpFlowContext & { preprompt?: string; abortSignal?: AbortSignal }): AsyncGenerator<
	MessageUpdate,
	boolean,
	undefined
> {
	// Start from env-configured servers
	let servers = getMcpServers();

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
			// Invalidate cached tool list when the set of servers changes at request-time
			resetMcpToolsCache();
			// Deduplicate by server name (request takes precedence)
			const byName = new Map<
				string,
				{ name: string; url: string; headers?: Record<string, string> }
			>();
			for (const s of servers) byName.set(s.name, s);
			for (const s of custom) byName.set(s.name, s);
			servers = [...byName.values()];
		}

		// If the client specified a selection by name, filter to those
		const names = Array.isArray(reqMcp?.selectedServerNames)
			? reqMcp?.selectedServerNames
			: undefined;
		if (Array.isArray(names)) {
			servers = servers.filter((s) => names.includes(s.name));
		}
	} catch {
		// ignore selection merge errors and proceed with env servers
	}
	logger.debug({ count: servers.length }, "[mcp] servers configured");
	if (servers.length === 0) {
		return false;
	}

	const hasImageInput = messages.some((msg) =>
		(msg.files ?? []).some(
			(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
		)
	);

	const { runMcp, targetModel, candidateModelId, resolvedRoute } = await resolveRouterTarget({
		model,
		messages,
		conversationId: conv._id.toString(),
		hasImageInput,
		locals,
	});

	if (!runMcp) {
		logger.debug("[mcp] runMcp=false (router did not select tools path)");
		return false;
	}

	const { tools: oaTools, mapping } = await getOpenAiToolsForMcp(servers, { signal: abortSignal });
	logger.debug({ tools: oaTools.length }, "[mcp] openai tool defs built");
	if (oaTools.length === 0) {
		return false;
	}

	try {
		const { OpenAI } = await import("openai");
		const openai = new OpenAI({
			apiKey: config.OPENAI_API_KEY || config.HF_TOKEN || "sk-",
			baseURL: config.OPENAI_BASE_URL,
		});

		const mmEnabled = (forceMultimodal ?? false) || targetModel.multimodal;
		logger.debug({ model: targetModel.id ?? targetModel.name, mmEnabled }, "[mcp] target model");
		const toOpenAiMessage = (msg: EndpointMessage): ChatCompletionMessageParam => {
			if (msg.from === "user" && mmEnabled) {
				const parts: ChatCompletionContentPart[] = [{ type: "text", text: msg.content }];
				for (const file of msg.files ?? []) {
					if (typeof file?.mime === "string" && file.mime.startsWith("image/")) {
						const rawValue = file.value as unknown;
						let encoded: string;
						if (typeof rawValue === "string") {
							encoded = rawValue;
						} else if (rawValue instanceof Uint8Array) {
							encoded = Buffer.from(rawValue).toString("base64");
						} else if (rawValue instanceof ArrayBuffer) {
							encoded = Buffer.from(rawValue).toString("base64");
						} else {
							encoded = String(rawValue ?? "");
						}
						const url = encoded.startsWith("data:")
							? encoded
							: `data:${file.mime};base64,${encoded}`;
						parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
					}
				}
				return { role: msg.from, content: parts };
			}
			return { role: msg.from, content: msg.content };
		};

		let messagesOpenAI: ChatCompletionMessageParam[] = messages.map(toOpenAiMessage);
		const toolPreprompt = buildToolPreprompt(oaTools);
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

		const parameters = { ...targetModel.parameters, ...assistant?.generateSettings } as Record<
			string,
			unknown
		>;
		const maxTokens =
			(parameters?.max_tokens as number | undefined) ??
			(parameters?.max_new_tokens as number | undefined) ??
			(parameters?.max_completion_tokens as number | undefined);

		const stopSequences =
			typeof parameters?.stop === "string"
				? parameters.stop
				: Array.isArray(parameters?.stop)
					? (parameters.stop as string[])
					: undefined;

		const completionBase: Omit<ChatCompletionCreateParamsStreaming, "messages"> = {
			model: targetModel.id ?? targetModel.name,
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
		};

		const toPrimitive = (value: unknown) => {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				return value;
			}
			return undefined;
		};

		const parseArgs = (raw: unknown): Record<string, unknown> => {
			if (typeof raw !== "string" || raw.trim().length === 0) return {};
			try {
				return JSON.parse(raw);
			} catch {
				return {};
			}
		};

		const processToolOutput = (
			text: string
		): {
			annotated: string;
			sources: { index: number; link: string }[];
		} => ({ annotated: text, sources: [] });

		let lastAssistantContent = "";
		let streamedContent = false;

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

		for (let loop = 0; loop < 5; loop += 1) {
			lastAssistantContent = "";
			streamedContent = false;

			const completionRequest: ChatCompletionCreateParamsStreaming = {
				...completionBase,
				messages: messagesOpenAI,
			};

			const completionStream: Stream<ChatCompletionChunk> = await openai.chat.completions.create(
				completionRequest,
				{
					signal: abortSignal,
					headers: {
						"ChatUI-Conversation-ID": conv._id.toString(),
						"X-use-cache": "false",
					},
				}
			);

			const toolCallState: Record<number, { id?: string; name?: string; arguments: string }> = {};
			let sawToolCall = false;
			let tokenCount = 0;
			for await (const chunk of completionStream) {
				const choice = chunk.choices?.[0];
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

				if (deltaContent) {
					lastAssistantContent += deltaContent;
					if (!sawToolCall) {
						streamedContent = true;
						yield { type: MessageUpdateType.Stream, token: deltaContent };
						tokenCount += deltaContent.length;
					}
				}
			}
			logger.debug(
				{ sawToolCalls: Object.keys(toolCallState).length > 0, tokens: tokenCount, loop },
				"[mcp] completion stream closed"
			);

			if (Object.keys(toolCallState).length > 0) {
				// If any streamed call is missing id, perform a quick non-stream retry to recover full tool_calls with ids
				const missingId = Object.values(toolCallState).some((c) => c?.name && !c?.id);
				let calls: NormalizedToolCall[];
				if (missingId) {
					const nonStream = await openai.chat.completions.create(
						{ ...completionBase, messages: messagesOpenAI, stream: false },
						{ signal: abortSignal }
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

				const assistantToolMessage: ChatCompletionMessageParam = {
					role: "assistant",
					content: lastAssistantContent,
					tool_calls: toolCalls,
				};

				const exec = executeToolCalls({
					calls,
					mapping,
					servers,
					parseArgs,
					toPrimitive,
					processToolOutput,
					abortSignal,
				});
				let toolMsgCount = 0;
				let toolRunCount = 0;
				for await (const event of exec) {
					if (event.type === "update") {
						yield event.update;
					} else {
						messagesOpenAI = [
							...messagesOpenAI,
							assistantToolMessage,
							...(event.summary.toolMessages ?? []),
						];
						toolMsgCount = event.summary.toolMessages?.length ?? 0;
						toolRunCount = event.summary.toolRuns?.length ?? 0;
						logger.debug(
							{ toolMsgCount, toolRunCount },
							"[mcp] tools executed; continuing loop for follow-up completion"
						);
					}
				}
				// Continue loop: next iteration will use tool messages to get the final content
				continue;
			}

			// No tool calls: finalize and return
			if (!streamedContent && lastAssistantContent.trim().length > 0) {
				yield { type: MessageUpdateType.Stream, token: lastAssistantContent };
			}
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: lastAssistantContent,
				interrupted: false,
			};
			logger.debug({ length: lastAssistantContent.length, loop }, "[mcp] final answer emitted");
			return true;
		}
		logger.warn("[mcp] exceeded tool-followup loops; falling back");
	} catch (err) {
		logger.warn({ err: String(err) }, "[mcp] flow failed, falling back to default endpoint");
	} finally {
		// ensure MCP clients are closed after the turn
		await drainPool();
	}

	return false;
}
