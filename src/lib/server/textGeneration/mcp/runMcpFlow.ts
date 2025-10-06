import { config } from "$lib/server/config";
import {
	MessageUpdateType,
	type MessageUpdate,
	type MessageSource,
} from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { generateFromDefaultEndpoint } from "../../generateFromDefaultEndpoint";
import { getMcpServers } from "$lib/server/mcp/registry";
import { getOpenAiToolsForMcp } from "$lib/server/mcp/tools";
import type {
	ChatCompletionChunk,
	ChatCompletionCreateParamsStreaming,
	ChatCompletionMessageParam,
	ChatCompletionContentPart,
	ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";
import { CitationTracker } from "../utils/citations";
import { buildToolPreprompt } from "../utils/toolPrompt";
import { resolveRouterTarget } from "./routerResolution";
import {
	executeToolCalls,
	type NormalizedToolCall,
	type ToolRun,
	type ToolCallExecutionResult,
} from "./toolInvocation";
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

	const { runMcp, targetModel, candidateModelId, resolvedRoute } = await resolveRouterTarget({
		model,
		messages,
		conversationId: conv._id.toString(),
		hasImageInput,
		locals,
	});

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

		const toolRuns: ToolRun[] = [];
		const citationTracker = new CitationTracker();

		const injectCitationMappingMessage = () => {
			const result = citationTracker.injectMappingMessage(messagesOpenAI);
			messagesOpenAI = result.messages;
		};

		const collectToolOutputSources = (
			text: string
		): {
			annotated: string;
			sources: { index: number; link: string }[];
		} => citationTracker.collectToolOutputSources(text);

		const appendMissingCitations = (text: string): string =>
			citationTracker.appendMissingCitations(text);

		const normalizeCitations = (
			text: string
		): { normalizedText: string; normalizedSources: MessageSource[] } =>
			citationTracker.normalizeCitations(text);

		const buildCitationMappingMessage = (): string | null => citationTracker.buildMappingMessage();

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
			injectCitationMappingMessage();

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

			const normalizedCalls = aggregatedCalls.filter(isNamedToolCall) as NormalizedToolCall[];

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

			const executionGenerator = executeToolCalls({
				calls: normalizedCalls,
				mapping,
				servers,
				parseArgs,
				toPrimitive,
				collectToolOutputSources,
			});

			let executionResult: ToolCallExecutionResult | undefined;
			for await (const event of executionGenerator) {
				if (event.type === "update") {
					yield event.update;
				} else if (event.type === "complete") {
					executionResult = event.summary;
				}
			}

			if (!executionResult) {
				logger.warn(
					{ serverCount: servers.length, callCount: normalizedCalls.length },
					"[mcp] executeToolCalls completed without summary"
				);
				return false;
			}

			if (executionResult.finalAnswer) {
				yield {
					type: MessageUpdateType.FinalAnswer,
					text: executionResult.finalAnswer.text,
					interrupted: executionResult.finalAnswer.interrupted,
				};
				return true;
			}

			toolRuns.push(...executionResult.toolRuns);
			const toolMessages: ChatCompletionMessageParam[] = executionResult.toolMessages;
			messagesOpenAI = [...messagesOpenAI, assistantToolMessage, ...toolMessages];
			injectCitationMappingMessage();
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
			const mappingDirective = buildCitationMappingMessage();

			const synthesis = yield* generateFromDefaultEndpoint({
				messages: [
					{
						from: "user",
						content: `Question: ${
							question
						}\n\nTool results:\n${formattedResults}\n\nUsing only the tool results above, answer the question concisely. If uncertain, say you don't know.${
							lastAssistantContent ? `\n\nModel notes: ${lastAssistantContent}` : ""
						}${mappingDirective ? `\n\n${mappingDirective}` : ""}`,
					},
				],
				preprompt:
					"You are a helpful assistant. Use the provided tool results as the sole source of truth.",
				generateSettings: { temperature: 0.2, max_tokens: 512 },
				modelId: candidateModelId ?? targetModel.id,
				locals,
			});

			const finalSynthesis = appendMissingCitations(synthesis);
			const { normalizedText, normalizedSources } = normalizeCitations(finalSynthesis);
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: normalizedText,
				interrupted: false,
				sources: normalizedSources.length > 0 ? normalizedSources : undefined,
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
			const finalAssistantContent = appendMissingCitations(lastAssistantContent);
			const { normalizedText, normalizedSources } = normalizeCitations(finalAssistantContent);
			yield {
				type: MessageUpdateType.FinalAnswer,
				text: normalizedText,
				interrupted: false,
				sources: normalizedSources.length > 0 ? normalizedSources : undefined,
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
