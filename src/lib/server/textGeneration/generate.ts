import { config } from "$lib/server/config";
import {
	MessageReasoningUpdateType,
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { AbortedGenerations } from "../abortedGenerations";
import type { TextGenerationContext } from "./types";
import type { EndpointMessage } from "../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../generateFromDefaultEndpoint";
import { generateSummaryOfReasoning } from "./reasoning";
import { logger } from "../logger";
import { getMcpServers } from "$lib/server/mcp/registry";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import { callMcpTool } from "$lib/server/mcp/httpClient";
import { archSelectRoute } from "$lib/server/router/arch";
import { getRoutes, resolveRouteModels } from "$lib/server/router/policy";
import { randomUUID } from "crypto";
import { ToolResultStatus } from "$lib/types/Tool";
import type { ProcessedModel } from "../models";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
	ChatCompletionContentPart,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

const ROUTER_REASONING_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(ROUTER_REASONING_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

function stripReasoningFromMessageForRouting(message: EndpointMessage): EndpointMessage {
	const clone = { ...message } as EndpointMessage & { reasoning?: string };
	if ("reasoning" in clone) {
		delete clone.reasoning;
	}
	const content =
		typeof message.content === "string" ? stripReasoningBlocks(message.content) : message.content;
	return {
		...clone,
		content,
	};
}

type ToolRun = {
	name: string;
	parameters: Record<string, string | number | boolean>;
	output: string;
};

function buildToolPreprompt(tools: OpenAiTool[]): string {
	if (!Array.isArray(tools) || tools.length === 0) {
		return "";
	}

	return `When using tools follow those rules:

- Decompose the user's request into distinct goals. When it mentions multiple entities (e.g., "X and Y") or sub-questions, issue a separate tool call for each.
- When a tool can produce information more accurately or faster than guessing, call it.
- After each tool result, check whether every part of the user's request is resolved. If not, refine the query or call another tool.
- When tool outputs include URLs, cite them inline using numbered Markdown links such as ([1](https://...)). Reuse numbers for repeat URLs and never invent links.
- Base the final answer solely on tool results; if the results leave gaps, say you don't know, and mention the tool names you used.`;
}

type RunMcpFlowContext = Pick<
	TextGenerationContext,
	"model" | "conv" | "assistant" | "forceMultimodal" | "locals"
> & { messages: EndpointMessage[] };

type GenerateFunctionContext = Omit<TextGenerationContext, "messages"> & {
	messages: EndpointMessage[];
};

async function* runMcpFlow({
	model,
	conv,
	messages,
	assistant,
	forceMultimodal,
	locals,
	preprompt,
}: RunMcpFlowContext & { preprompt?: string }): AsyncGenerator<MessageUpdate, boolean, undefined> {
	const servers = getMcpServers();
	if (servers.length === 0) {
		return false;
	}

	const hasImageInput = messages.some((msg) =>
		(msg.files ?? []).some(
			(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
		)
	);

	let runMcp = true;
	let targetModel = model;
	let candidateModelId: string | undefined;
	let resolvedRoute: string | undefined;

	if (model.isRouter) {
		try {
			const mod = await import("../models");
			const allModels = mod.models as ProcessedModel[];

			if (hasImageInput) {
				const multimodalCandidate = allModels?.find(
					(candidate) => !candidate.isRouter && candidate.multimodal
				);
				if (multimodalCandidate) {
					targetModel = multimodalCandidate;
					candidateModelId = multimodalCandidate.id ?? multimodalCandidate.name;
					resolvedRoute = "multimodal";
				} else {
					runMcp = false;
				}
			} else {
				const routes = await getRoutes();
				const sanitized = messages.map(stripReasoningFromMessageForRouting);
				const { routeName } = await archSelectRoute(sanitized, conv._id.toString(), locals);
				resolvedRoute = routeName;
				const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || model.id;
				const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);
				const primaryCandidateId = candidates[0];
				if (!primaryCandidateId || primaryCandidateId === fallbackModel) {
					runMcp = false;
				} else {
					const found = allModels?.find(
						(candidate) =>
							candidate.id === primaryCandidateId || candidate.name === primaryCandidateId
					);
					if (found) {
						targetModel = found;
						candidateModelId = primaryCandidateId;
					} else {
						runMcp = false;
					}
				}
			}
		} catch (error) {
			logger.warn({ err: String(error) }, "[mcp] routing preflight failed");
			runMcp = false;
		}
	}

	if (!runMcp) {
		return false;
	}

	const { tools: oaTools, mapping } = await getOpenAiToolsForMcp(servers);
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
						parts.push({
							type: "image_url",
							image_url: { url, detail: "auto" },
						});
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

		if (
			!targetModel.systemRoleSupported &&
			messagesOpenAI.length > 0 &&
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

		const toPrimitive = (value: unknown): string | number | boolean | undefined => {
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

		const toolRuns: ToolRun[] = [];
		let lastAssistantContent = "";
		let streamedContent = false;

		if (resolvedRoute && candidateModelId) {
			yield {
				type: MessageUpdateType.RouterMetadata,
				route: resolvedRoute,
				model: candidateModelId,
			};
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
					headers: {
						"ChatUI-Conversation-ID": conv._id.toString(),
						"X-use-cache": "false",
					},
				}
			);

			const toolCallState: Record<number, { id?: string; name?: string; arguments: string }> = {};
			let sawToolCall = false;

			for await (const chunk of completionStream) {
				const choice = chunk.choices?.[0];
				const delta = choice?.delta;
				if (!delta) continue;

				const chunkToolCalls = delta.tool_calls ?? [];
				if (chunkToolCalls.length > 0) {
					sawToolCall = true;
					for (const call of chunkToolCalls) {
						const index = call.index ?? 0;
						const current = toolCallState[index] ?? { arguments: "" };
						if (call.id) current.id = call.id;
						if (call.function?.name) current.name = call.function.name;
						if (call.function?.arguments) current.arguments += call.function.arguments;
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
								typeof (part as { text?: unknown }).text === "string"
									? (part as { text: string }).text
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
						yield {
							type: MessageUpdateType.Stream,
							token: deltaContent,
						};
					}
				}
			}

			const aggregatedCalls = Object.values(toolCallState).map((call, index) => ({
				id: call.id ?? `call_${index}`,
				name: call.name,
				arguments: call.arguments,
			}));

			const isNamedToolCall = (
				call: (typeof aggregatedCalls)[number]
			): call is (typeof aggregatedCalls)[number] & { name: string } =>
				typeof call.name === "string" && call.name.length > 0;

			const normalizedCalls = aggregatedCalls.filter(isNamedToolCall);

			if (!normalizedCalls.length) {
				break;
			}

			const toolCalls: ChatCompletionMessageToolCall[] = normalizedCalls.map((call) => ({
				id: call.id,
				type: "function",
				function: { name: call.name, arguments: call.arguments },
			}));

			const assistantToolMessage: ChatCompletionMessageParam = {
				role: "assistant",
				content: lastAssistantContent,
				tool_calls: toolCalls,
			};

			const toolMessages: ChatCompletionMessageParam[] = [];

			for (const call of normalizedCalls) {
				const fnName = call.name;
				const mappingEntry = mapping[fnName];
				const uuid = randomUUID();
				const argsObj = parseArgs(call.arguments);
				const parametersClean: Record<string, string | number | boolean> = {};
				for (const [key, value] of Object.entries(argsObj ?? {})) {
					const primitive = toPrimitive(value);
					if (primitive !== undefined) {
						parametersClean[key] = primitive;
					}
				}

				yield {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Call,
					uuid,
					call: { name: fnName, parameters: parametersClean },
				};

				yield {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.ETA,
					uuid,
					eta: 10,
				};

				if (!mappingEntry) {
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Error,
						uuid,
						message: `Unknown MCP function: ${fnName}`,
					};
					yield {
						type: MessageUpdateType.FinalAnswer,
						text: `Unknown MCP function: ${fnName}`,
						interrupted: false,
					};
					return true;
				}

				const serverConfig = servers.find((server) => server.name === mappingEntry.server);
				if (!serverConfig) {
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Error,
						uuid,
						message: `Unknown MCP server: ${mappingEntry.server}`,
					};
					yield {
						type: MessageUpdateType.FinalAnswer,
						text: `Unknown MCP server: ${mappingEntry.server}`,
						interrupted: false,
					};
					return true;
				}

				try {
					logger.debug(
						{ server: mappingEntry.server, tool: mappingEntry.tool, parameters: parametersClean },
						"[mcp] invoking tool"
					);
					const output = await callMcpTool(serverConfig, mappingEntry.tool, argsObj);
					logger.debug(
						{ server: mappingEntry.server, tool: mappingEntry.tool },
						"[mcp] tool call completed"
					);

					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Result,
						uuid,
						result: {
							status: ToolResultStatus.Success,
							call: { name: fnName, parameters: parametersClean },
							outputs: [{ content: output }],
							display: true,
						},
					};

					toolRuns.push({ name: fnName, parameters: parametersClean, output });
					toolMessages.push({ role: "tool", tool_call_id: call.id, content: output });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					logger.warn(
						{ server: mappingEntry.server, tool: mappingEntry.tool, err: message },
						"[mcp] tool call failed"
					);
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Error,
						uuid,
						message,
					};
					yield {
						type: MessageUpdateType.FinalAnswer,
						text: `MCP error: ${message}`,
						interrupted: false,
					};
					return true;
				}
			}

			messagesOpenAI = [...messagesOpenAI, assistantToolMessage, ...toolMessages];
		}

		if (toolRuns.length > 0 && !lastAssistantContent.trim()) {
			const question = messages[messages.length - 1]?.content ?? "";
			const formattedResults = toolRuns
				.map((run, index) => {
					const argsEntries = Object.entries(run.parameters);
					const argsString = argsEntries.length
						? `Arguments: ${JSON.stringify(Object.fromEntries(argsEntries), null, 2)}\n`
						: "";
					return `Tool ${index + 1}: ${run.name}\n${argsString}Output:\n${run.output}`;
				})
				.join("\n\n");

			const synthesis = yield* generateFromDefaultEndpoint({
				messages: [
					{
						from: "user",
						content: `Question: ${question}\n\nTool results:\n${formattedResults}\n\nUsing only the tool results above, answer the question concisely. If uncertain, say you don't know.${
							lastAssistantContent ? `\n\nModel notes: ${lastAssistantContent}` : ""
						}`,
					},
				],
				preprompt:
					"You are a helpful assistant. Use the provided tool results as the sole source of truth.",
				generateSettings: { temperature: 0.2, max_tokens: 512 },
				modelId: candidateModelId ?? targetModel.id,
				locals,
			});

			yield {
				type: MessageUpdateType.FinalAnswer,
				text: synthesis,
				interrupted: false,
			};

			return true;
		}

		if (lastAssistantContent) {
			if (!streamedContent) {
				yield {
					type: MessageUpdateType.Stream,
					token: lastAssistantContent,
				};
			}
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: lastAssistantContent,
				interrupted: false,
			};
			return true;
		}

		return false;
	} catch (error) {
		logger.warn(
			{ err: String(error) },
			"[mcp] tool flow failed; falling back to default generation"
		);
	}

	return false;
}

export async function* generate(
	{
		model,
		endpoint,
		conv,
		messages,
		assistant,
		isContinue,
		promptedAt,
		forceMultimodal,
		locals,
	}: GenerateFunctionContext,
	preprompt?: string
): AsyncIterable<MessageUpdate> {
	const handledByMcp = yield* runMcpFlow({
		model,
		conv,
		messages,
		assistant,
		forceMultimodal,
		locals,
		preprompt,
	});

	if (handledByMcp) {
		return;
	}

	// reasoning mode is false by default
	let reasoning = false;
	let reasoningBuffer = "";
	let lastReasoningUpdate = new Date();
	let status = "";
	const startTime = new Date();
	if (
		model.reasoning &&
		// if the beginToken is an empty string, the model starts in reasoning mode
		(model.reasoning.type === "regex" ||
			model.reasoning.type === "summarize" ||
			(model.reasoning.type === "tokens" && model.reasoning.beginToken === ""))
	) {
		// if the model has reasoning in regex or summarize mode, it starts in reasoning mode
		// and we extract the answer from the reasoning
		reasoning = true;
		yield {
			type: MessageUpdateType.Reasoning,
			subtype: MessageReasoningUpdateType.Status,
			status: "Started reasoning...",
		};
	}

	for await (const output of await endpoint({
		messages,
		preprompt,
		continueMessage: isContinue,
		generateSettings: assistant?.generateSettings,
		// Allow user-level override to force multimodal
		isMultimodal: (forceMultimodal ?? false) || model.multimodal,
		conversationId: conv._id,
		locals,
	})) {
		// Check if this output contains router metadata
		if (
			"routerMetadata" in output &&
			output.routerMetadata &&
			output.routerMetadata.route &&
			output.routerMetadata.model
		) {
			yield {
				type: MessageUpdateType.RouterMetadata,
				route: output.routerMetadata.route,
				model: output.routerMetadata.model,
			};
			continue;
		}
		// text generation completed
		if (output.generated_text) {
			let interrupted =
				!output.token.special && !model.parameters.stop?.includes(output.token.text);

			let text = output.generated_text.trimEnd();
			for (const stopToken of model.parameters.stop ?? []) {
				if (!text.endsWith(stopToken)) continue;

				interrupted = false;
				text = text.slice(0, text.length - stopToken.length);
			}

			let finalAnswer = text;
			if (model.reasoning && model.reasoning.type === "regex") {
				const regex = new RegExp(model.reasoning.regex);
				finalAnswer = regex.exec(reasoningBuffer)?.[1] ?? text;
			} else if (model.reasoning && model.reasoning.type === "summarize") {
				yield {
					type: MessageUpdateType.Reasoning,
					subtype: MessageReasoningUpdateType.Status,
					status: "Summarizing reasoning...",
				};
				try {
					const summary = yield* generateFromDefaultEndpoint({
						messages: [
							{
								from: "user",
								content: `Question: ${
									messages[messages.length - 1].content
								}\n\nReasoning: ${reasoningBuffer}`,
							},
						],
						preprompt: `Your task is to summarize concisely all your reasoning steps and then give the final answer. Keep it short, one short paragraph at most. If the reasoning steps explicitly include a code solution, make sure to include it in your answer.

If the user is just having a casual conversation that doesn't require explanations, answer directly without explaining your steps, otherwise make sure to summarize step by step, make sure to skip dead-ends in your reasoning and removing excess detail.

Do not use prefixes such as Response: or Answer: when answering to the user.`,
						generateSettings: {
							max_tokens: 1024,
						},
						modelId: model.id,
						locals,
					});
					finalAnswer = summary;
					yield {
						type: MessageUpdateType.Reasoning,
						subtype: MessageReasoningUpdateType.Status,
						status: `Done in ${Math.round((new Date().getTime() - startTime.getTime()) / 1000)}s.`,
					};
				} catch (e) {
					finalAnswer = text;
					logger.error(e);
				}
			} else if (model.reasoning && model.reasoning.type === "tokens") {
				// make sure to remove the content of the reasoning buffer from
				// the final answer to avoid duplication

				// if the beginToken is an empty string, we don't need to remove anything
				const beginIndex = model.reasoning.beginToken
					? reasoningBuffer.indexOf(model.reasoning.beginToken)
					: 0;
				const endIndex = reasoningBuffer.lastIndexOf(model.reasoning.endToken);

				if (beginIndex !== -1 && endIndex !== -1) {
					// Remove the reasoning section (including tokens) from final answer
					finalAnswer =
						text.slice(0, beginIndex) + text.slice(endIndex + model.reasoning.endToken.length);
				}
			}

			yield {
				type: MessageUpdateType.FinalAnswer,
				text: finalAnswer,
				interrupted,
			};
			continue;
		}

		if (model.reasoning && model.reasoning.type === "tokens") {
			if (output.token.text === model.reasoning.beginToken) {
				reasoning = true;
				reasoningBuffer += output.token.text;
				continue;
			} else if (output.token.text === model.reasoning.endToken) {
				reasoning = false;
				reasoningBuffer += output.token.text;
				yield {
					type: MessageUpdateType.Reasoning,
					subtype: MessageReasoningUpdateType.Status,
					status: `Done in ${Math.round((new Date().getTime() - startTime.getTime()) / 1000)}s.`,
				};
				continue;
			}
		}
		// ignore special tokens
		if (output.token.special) continue;

		// pass down normal token
		if (reasoning) {
			reasoningBuffer += output.token.text;

			if (model.reasoning && model.reasoning.type === "tokens") {
				// split reasoning buffer so that anything that comes after the end token is separated
				// add it to the normal buffer, and yield two updates, one for the reasoning and one for the normal content
				// also set reasoning to false

				if (reasoningBuffer.lastIndexOf(model.reasoning.endToken) !== -1) {
					const endTokenIndex = reasoningBuffer.lastIndexOf(model.reasoning.endToken);
					const textBuffer = reasoningBuffer.slice(endTokenIndex + model.reasoning.endToken.length);
					reasoningBuffer = reasoningBuffer.slice(
						0,
						endTokenIndex + model.reasoning.endToken.length + 1
					);

					yield {
						type: MessageUpdateType.Reasoning,
						subtype: MessageReasoningUpdateType.Stream,
						token: output.token.text,
					};

					yield {
						type: MessageUpdateType.Stream,
						token: textBuffer,
					};

					yield {
						type: MessageUpdateType.Reasoning,
						subtype: MessageReasoningUpdateType.Status,
						status: `Done in ${Math.round((new Date().getTime() - startTime.getTime()) / 1000)}s.`,
					};

					reasoning = false;
					continue;
				}
			}
			// yield status update if it has changed
			if (status !== "") {
				yield {
					type: MessageUpdateType.Reasoning,
					subtype: MessageReasoningUpdateType.Status,
					status,
				};
				status = "";
			}

			// create a new status every 5 seconds
			if (
				config.REASONING_SUMMARY === "true" &&
				new Date().getTime() - lastReasoningUpdate.getTime() > 4000
			) {
				lastReasoningUpdate = new Date();
				try {
					generateSummaryOfReasoning(reasoningBuffer, model.id, locals).then((summary) => {
						status = summary;
					});
				} catch (e) {
					logger.error(e);
				}
			}
			yield {
				type: MessageUpdateType.Reasoning,
				subtype: MessageReasoningUpdateType.Stream,
				token: output.token.text,
			};
		} else {
			yield { type: MessageUpdateType.Stream, token: output.token.text };
		}

		// abort check
		const date = AbortedGenerations.getInstance().getAbortTime(conv._id.toString());

		if (date && date > promptedAt) {
			logger.info(`Aborting generation for conversation ${conv._id}`);
			break;
		}

		// no output check
		if (!output) break;
	}
}
