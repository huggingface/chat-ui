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
import type { McpServerConfig } from "$lib/server/mcp/httpClient";
import { archSelectRoute } from "$lib/server/router/arch";
import { getRoutes, resolveRouteModels } from "$lib/server/router/policy";
import { randomUUID } from "crypto";
import { ToolResultStatus } from "$lib/types/Tool";
import { Agent, type ServerConfig as McpServerConfigWithTransport } from "@huggingface/mcp-client";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio";
import type { ChatCompletionInputMessage } from "@huggingface/tasks";

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

type GenerateContext = Omit<TextGenerationContext, "messages"> & { messages: EndpointMessage[] };

type ToolCallState = {
	index: number;
	id: string;
	name?: string;
	rawArgs: string;
	uuid: string;
	emitted: boolean;
	parameters?: Record<string, string | number | boolean>;
};

function toAgentServerConfig(
	server: McpServerConfig
): McpServerConfigWithTransport | StdioServerParameters | null {
	try {
		const url = new URL(server.url);
		const headers = { ...(server.headers ?? {}) };
		const hasHeaders = Object.keys(headers).length > 0;

		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return null;
		}

		if (url.pathname.endsWith("/sse")) {
			return {
				type: "sse",
				config: {
					url: server.url,
					options: {
						requestInit: hasHeaders ? { headers } : undefined,
						eventSourceInit: hasHeaders
							? {
								fetch: (input, init) => {
									const mergedHeaders = new Headers(init?.headers ?? {});
									for (const [key, value] of Object.entries(headers)) {
										mergedHeaders.set(key, value);
									}
									return fetch(input, { ...init, headers: mergedHeaders });
								},
							}
							: undefined,
					},
				},
			};
		}

		return {
			type: "http",
			config: {
				url: server.url,
				options: hasHeaders ? { requestInit: { headers } } : undefined,
			},
		};
	} catch (error) {
		logger.warn({ err: String(error), url: server.url }, "[mcp] invalid server configuration");
		return null;
	}
}

function buildAgentMessages(
	messages: EndpointMessage[],
	preprompt: string | undefined,
	multimodal: boolean
): ChatCompletionInputMessage[] {
	const converted: ChatCompletionInputMessage[] = messages.map((message) => {
		if (message.from === "user" && multimodal) {
			const parts: any[] = [];
			if (message.content) {
				parts.push({ type: "text", text: message.content });
			}
			for (const file of message.files ?? []) {
				if (typeof file?.mime === "string" && file.mime.startsWith("image/")) {
					const rawValue = file.value;
					const encoded =
						typeof rawValue === "string"
							? rawValue
							: Buffer.isBuffer(rawValue)
							? rawValue.toString("base64")
							: String(rawValue ?? "");
					const url = encoded.startsWith("data:")
						? encoded
						: `data:${file.mime};base64,${encoded}`;
					parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
				}
			}
			return {
				role: message.from,
				content: parts.length > 0 ? parts : [{ type: "text", text: message.content ?? "" }],
			};
		}

		return {
			role: message.from,
			content: message.content,
		};
	});

	if (converted.length === 0) {
		return preprompt ? [{ role: "system", content: preprompt }] : [];
	}

	if (converted[0].role === "system") {
		if (preprompt && preprompt.length > 0) {
			const existing = typeof converted[0].content === "string" ? converted[0].content : "";
			converted[0] = {
				...converted[0],
				content: existing ? `${preprompt}\n\n${existing}` : preprompt,
			};
		}
		return converted;
	}

	if (preprompt !== undefined && preprompt.length > 0) {
		return [{ role: "system", content: preprompt }, ...converted];
	}

	return converted;
}

function parseArgs(raw: string): Record<string, unknown> {
	if (!raw || raw.trim().length === 0) {
		return {};
	}

	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function toPrimitive(value: unknown): string | number | boolean | undefined {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return undefined;
}

function buildParameterSummary(rawArgs: string): Record<string, string | number | boolean> {
	const parsed = parseArgs(rawArgs);
	const result: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(parsed)) {
		const primitive = toPrimitive(value);
		if (primitive !== undefined) {
			result[key] = primitive;
		}
	}
	return result;
}

async function* runMcpFlow(
	{
		model,
		conv,
		messages,
		assistant,
		forceMultimodal,
		preprompt,
	}: GenerateContext & { preprompt?: string }
): AsyncGenerator<MessageUpdate, boolean, undefined> {
	const servers = getMcpServers();
	logger.debug({ count: servers.length }, "[mcp-agent] resolved MCP servers");
	if (servers.length === 0) {
		return false;
	}

	const hasImageInput = messages.some((msg) =>
		(msg.files ?? []).some((file) => typeof file?.mime === "string" && file.mime.startsWith("image/"))
	);
	logger.debug({ hasImageInput }, "[mcp-agent] message modality analysis");

	let runMcp = true;
	let targetModel = model;
	let candidateModelId: string | undefined;
	let resolvedRoute: string | undefined;

	if ((model as any)?.isRouter) {
		try {
			const mod = await import("../models");
			const allModels = (mod as any).models as typeof model[];

			if (hasImageInput) {
				const multimodalCandidate = allModels?.find(
					(candidate) => !candidate.isRouter && candidate.multimodal
				);
				if (multimodalCandidate) {
					targetModel = multimodalCandidate;
					candidateModelId = multimodalCandidate.id ?? multimodalCandidate.name;
					resolvedRoute = "multimodal";
					logger.debug({ candidateModelId }, "[mcp-agent] selected multimodal candidate from router");
				} else {
					runMcp = false;
				}
			} else {
				const routes = await getRoutes();
				const sanitized = messages.map(stripReasoningFromMessageForRouting);
				const { routeName } = await archSelectRoute(sanitized);
				resolvedRoute = routeName;
				const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || model.id;
				const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);
				const primaryCandidateId = candidates[0];
				if (!primaryCandidateId || primaryCandidateId === fallbackModel) {
					runMcp = false;
				} else {
					const found = allModels?.find(
						(candidate) => candidate.id === primaryCandidateId || candidate.name === primaryCandidateId
					);
					if (found) {
						targetModel = found;
						candidateModelId = primaryCandidateId;
						logger.debug({ routeName, candidateModelId }, "[mcp-agent] router selected candidate model");
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
		logger.debug("[mcp-agent] skipping MCP flow due to routing/multimodal constraints");
		return false;
	}

	const agentServers: (McpServerConfigWithTransport | StdioServerParameters)[] = [];
	for (const server of servers) {
		const converted = toAgentServerConfig(server);
		if (converted) {
			agentServers.push(converted);
		} else {
			logger.debug({ server: server.name }, "[mcp-agent] skipped server due to unsupported transport");
		}
	}

	if (agentServers.length === 0) {
		logger.debug("[mcp-agent] no usable MCP transports after conversion");
		return false;
	}

	const endpointUrl = config.OPENAI_BASE_URL;
	const modelId = targetModel.id ?? targetModel.name;
	if (!endpointUrl || !modelId) {
		logger.warn({ endpointUrl, modelId }, "[mcp-agent] missing endpoint or model id");
		return false;
	}

	const agent = new Agent({
		endpointUrl,
		model: modelId,
		apiKey: config.OPENAI_API_KEY || config.HF_TOKEN,
		servers: agentServers,
		prompt: preprompt && preprompt.length > 0 ? preprompt : undefined,
	});

	try {
		await agent.loadTools();
		logger.debug({ tools: agent.availableTools.map((tool) => tool.function.name) }, "[mcp-agent] loaded tools");
	} catch (error) {
		logger.warn({ err: String(error) }, "[mcp] failed to load MCP tools via Agent");
		await agent.cleanup().catch(() => {});
		return false;
	}

	if (resolvedRoute && candidateModelId) {
		yield {
			type: MessageUpdateType.RouterMetadata,
			route: resolvedRoute,
			model: candidateModelId,
		};
	}

	const mmEnabled = (forceMultimodal ?? false) || targetModel.multimodal;
	const agentMessages = buildAgentMessages(messages, preprompt, mmEnabled);

	let pendingAssistant = "";
	let finalAnswerSent = false;
	let toolPhaseActive = false;

	const toolCallStatesByIndex = new Map<number, ToolCallState>();
	const toolCallStatesById = new Map<string, ToolCallState>();

	logger.debug({ messageCount: agentMessages.length }, "[mcp-agent] starting agent run");
	try {
		for await (const chunk of agent.run(agentMessages)) {
			if ("choices" in chunk) {
				const delta = chunk.choices?.[0]?.delta;
				if (!delta) {
					continue;
				}

				const chunkToolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
				if (chunkToolCalls.length > 0) {
					toolPhaseActive = true;
					logger.debug({ count: chunkToolCalls.length }, "[mcp-agent] received tool call delta");
					for (const call of chunkToolCalls) {
						const index = call.index ?? 0;
					let state = toolCallStatesByIndex.get(index);
					if (!state) {
						state = {
							index,
							id: call.id ?? `call_${index}`,
							rawArgs: "",
							uuid: randomUUID(),
							emitted: false,
						};
						toolCallStatesByIndex.set(index, state);
						toolCallStatesById.set(state.id, state);
					}

					if (call.id && call.id !== state.id) {
						toolCallStatesById.delete(state.id);
						state.id = call.id;
						oolCallStatesById.set(state.id, state);
					}

						if (call.function?.name) {
							state.name = call.function.name;
						}
						if (call.function?.arguments) {
							state.rawArgs += call.function.arguments;
						}

						if (!state.emitted && state.name) {
							state.parameters = buildParameterSummary(state.rawArgs);
							yield {
								type: MessageUpdateType.Tool,
								subtype: MessageToolUpdateType.Call,
								uuid: state.uuid,
								call: { name: state.name, parameters: state.parameters },
							};
							yield {
								type: MessageUpdateType.Tool,
								subtype: MessageToolUpdateType.ETA,
								uuid: state.uuid,
								eta: 10,
							};
							state.emitted = true;
						}
					}
				}

				const deltaContent = (() => {
					if (typeof delta.content === "string") {
						return delta.content;
					}
					if (Array.isArray(delta.content)) {
						return delta.content
							.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
							.join("");
					}
					return "";
				})();

				if (deltaContent && !toolPhaseActive) {
					pendingAssistant += deltaContent;
				}
			} else {
				const toolMessage = chunk;
				const state = toolMessage.tool_call_id
					? toolCallStatesById.get(toolMessage.tool_call_id)
					: undefined;

				const uuid = state?.uuid ?? randomUUID();
				const toolName = toolMessage.name ?? state?.name ?? "unknown";
				const parameters = state?.parameters ?? buildParameterSummary(state?.rawArgs ?? "");
				const content = toolMessage.content ?? "";
				const isError = content.trim().toLowerCase().startsWith("error:");
				logger.debug({ toolName, isError }, "[mcp-agent] received tool result chunk");

				if (state && !state.emitted) {
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Call,
						uuid,
						call: { name: toolName, parameters },
					};
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.ETA,
						uuid,
						eta: 10,
					};
					state.emitted = true;
				}

				if (isError) {
					yield {
						type: MessageUpdateType.Tool,
						subtype: MessageToolUpdateType.Error,
						uuid,
						message: content,
					};
					yield {
						type: MessageUpdateType.FinalAnswer,
						text: content,
						interrupted: false,
					};
					finalAnswerSent = true;
					return true;
				}

				yield {
					type: MessageUpdateType.Tool,
					subtype: MessageToolUpdateType.Result,
					uuid,
					result: {
						status: ToolResultStatus.Success,
						call: { name: toolName, parameters },
						outputs: [{ content }],
						display: true,
					},
				};

				if (state) {
					toolCallStatesById.delete(state.id);
					toolCallStatesByIndex.delete(state.index);
				}

				toolPhaseActive = false;
				pendingAssistant = "";
			}
		}
	} catch (error) {
		logger.warn({ err: String(error) }, "[mcp] agent loop failed; falling back to default generation");
		return false;
	} finally {
		await agent.cleanup().catch(() => {});
	}

	if (pendingAssistant.trim().length > 0) {
		yield {
			type: MessageUpdateType.Stream,
			token: pendingAssistant,
		};
		yield {
			type: MessageUpdateType.FinalAnswer,
			text: pendingAssistant,
			interrupted: false,
		};
		finalAnswerSent = true;
	}

	return finalAnswerSent;
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
	}: GenerateContext,
	preprompt?: string
): AsyncIterable<MessageUpdate> {
	const handledByMcp = yield* runMcpFlow({
		model,
		conv,
		messages,
		assistant,
		forceMultimodal,
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
					generateSummaryOfReasoning(reasoningBuffer, model.id).then((summary) => {
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
