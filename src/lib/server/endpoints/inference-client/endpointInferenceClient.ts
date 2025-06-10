import { z } from "zod";
import type { Endpoint, TextGenerationStreamOutputWithToolsAndWebSources } from "../endpoints";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import { INFERENCE_PROVIDERS, InferenceClient } from "@huggingface/inference";
import { config } from "$lib/server/config";
import type { Tool, ToolCall } from "$lib/types/Tool";
import type { ChatCompletionStreamOutput } from "@huggingface/tasks";
import type { FunctionDefinition } from "openai/resources/index.mjs";
import type { ChatCompletionTool, FunctionParameters } from "openai/resources/index.mjs";
import { logger } from "$lib/server/logger";
import type { MessageFile } from "$lib/types/Message";
import { v4 as uuidv4 } from "uuid";
import type { Conversation } from "$lib/types/Conversation";
import { downloadFile } from "$lib/server/files/downloadFile";
import { jsonrepair } from "jsonrepair";
type DeltaToolCall = NonNullable<
	ChatCompletionStreamOutput["choices"][number]["delta"]["tool_calls"]
>[number];

function createChatCompletionToolsArray(tools: Tool[] | undefined): ChatCompletionTool[] {
	const toolChoices = [] as ChatCompletionTool[];
	if (tools === undefined) {
		return toolChoices;
	}

	for (const t of tools) {
		const requiredProperties = [] as string[];

		const properties = {} as Record<string, unknown>;
		for (const idx in t.inputs) {
			const parameterDefinition = t.inputs[idx];

			const parameter = {} as Record<string, unknown>;
			switch (parameterDefinition.type) {
				case "str":
					parameter.type = "string";
					break;
				case "float":
				case "int":
					parameter.type = "number";
					break;
				case "bool":
					parameter.type = "boolean";
					break;
				case "file":
					throw new Error("File type's currently not supported");
				default:
					throw new Error(`Unknown tool IO type: ${t}`);
			}

			if ("description" in parameterDefinition) {
				parameter.description = parameterDefinition.description;
			}

			if (parameterDefinition.paramType == "required") {
				requiredProperties.push(t.inputs[idx].name);
			}

			properties[t.inputs[idx].name] = parameter;
		}

		const functionParameters: FunctionParameters = {
			type: "object",
			...(requiredProperties.length > 0 ? { required: requiredProperties } : {}),
			properties,
		};

		const functionDefinition: FunctionDefinition = {
			name: t.name,
			description: t.description,
			parameters: functionParameters,
		};

		const toolDefinition: ChatCompletionTool = {
			type: "function",
			function: functionDefinition,
		};

		toolChoices.push(toolDefinition);
	}

	return toolChoices;
}

export const endpointInferenceClientParametersSchema = z.object({
	type: z.literal("inference-client"),
	weight: z.number().int().positive().default(1),
	model: z.any(),
	provider: z.enum(INFERENCE_PROVIDERS).optional(),
	modelName: z.string().optional(),
	baseURL: z.string().optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: [
					"image/png",
					"image/jpeg",
					"image/webp",
					"image/avif",
					"image/tiff",
					"image/gif",
				],
				preferredMimeType: "image/webp",
				maxSizeInMB: Infinity,
				maxWidth: 4096,
				maxHeight: 4096,
			}),
		})
		.default({}),
	customHeaders: z.record(z.string(), z.string()).default({}),
});

export async function endpointInferenceClient(
	input: z.input<typeof endpointInferenceClientParametersSchema>
): Promise<Endpoint> {
	const { model, provider, modelName, baseURL, multimodal, customHeaders } =
		endpointInferenceClientParametersSchema.parse(input);

	if (!!provider && !!baseURL) {
		throw new Error("provider and baseURL cannot both be provided");
	}
	const client = baseURL
		? new InferenceClient(config.HF_TOKEN, { endpointUrl: baseURL })
		: new InferenceClient(config.HF_TOKEN);

	const imageProcessor = multimodal.image ? makeImageProcessor(multimodal.image) : undefined;

	async function prepareFiles(files: MessageFile[], conversationId?: Conversation["_id"]) {
		if (!imageProcessor) {
			return [];
		}
		const processedFiles = await Promise.all(
			files
				.filter((file) => file.mime.startsWith("image/"))
				.map(async (file) => {
					if (file.type === "hash" && conversationId) {
						file = await downloadFile(file.value, conversationId);
					}
					return imageProcessor(file);
				})
		);
		return processedFiles.map((file) => ({
			type: "image_url" as const,
			image_url: {
				url: `data:${file.mime};base64,${file.image.toString("base64")}`,
			},
		}));
	}

	return async ({ messages, generateSettings, tools, toolResults, preprompt, conversationId }) => {
		/* eslint-disable @typescript-eslint/no-explicit-any */
		let messagesArray = (await Promise.all(
			messages.map(async (message) => {
				return {
					role: message.from,
					content: [
						...(await prepareFiles(message.files ?? [], conversationId)),
						{ type: "text" as const, text: message.content },
					],
				};
			})
		)) as any[];

		if (
			!model.systemRoleSupported &&
			messagesArray.length > 0 &&
			messagesArray[0]?.role === "system"
		) {
			messagesArray[0].role = "user";
		} else if (messagesArray[0].role !== "system") {
			messagesArray.unshift({
				role: "system",
				content: preprompt ?? "",
			});
		}

		if (toolResults && toolResults.length > 0) {
			messagesArray = [
				...messagesArray,
				{
					role: "assistant",
					content: [
						{
							type: "text" as const,
							text: "",
						},
					],
					tool_calls: toolResults.map((toolResult) => ({
						type: "function",
						function: {
							name: toolResult.call.name,
							arguments: JSON.stringify(toolResult.call.parameters),
						},
						id: toolResult?.call?.toolId || uuidv4(),
					})),
				},
				...toolResults.map((toolResult) => ({
					role: model.systemRoleSupported ? "tool" : "user",
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(toolResult),
						},
					],
					tool_call_id: toolResult?.call?.toolId || uuidv4(),
				})),
			];
		}

		messagesArray = messagesArray.reduce((acc: typeof messagesArray, current) => {
			if (acc.length === 0 || current.role !== acc[acc.length - 1].role) {
				acc.push(current);
			} else {
				const prevMessage = acc[acc.length - 1];

				prevMessage.content = [
					...prevMessage.content.filter((item: any) => item.type !== "text"),
					...current.content.filter((item: any) => item.type !== "text"),
					{
						type: "text" as const,
						text: [
							...prevMessage.content.filter((item: any) => item.type === "text"),
							...current.content.filter((item: any) => item.type === "text"),
						]
							.map((item: any) => item.text)
							.join("\n")
							.replace(/^\n/, ""),
					},
				];

				prevMessage.files = [...(prevMessage?.files ?? []), ...(current?.files ?? [])];

				prevMessage.tool_calls = [
					...(prevMessage?.tool_calls ?? []),
					...(current?.tool_calls ?? []),
				];
			}
			return acc;
		}, []);
		const toolCallChoices = createChatCompletionToolsArray(tools);
		const stream = client.chatCompletionStream(
			{
				...model.parameters,
				...generateSettings,
				model: modelName ?? model.id ?? model.name,
				provider: baseURL ? undefined : provider || ("hf-inference" as const),
				messages: messagesArray,
				...(toolCallChoices.length > 0 ? { tools: toolCallChoices, tool_choice: "auto" } : {}),
				toolResults,
			},
			{
				fetch: async (url, options) => {
					return fetch(url, {
						...options,
						headers: {
							...options?.headers,
							"X-Use-Cache": "false",
							"ChatUI-Conversation-ID": conversationId?.toString() ?? "",
							...customHeaders,
						},
					});
				},
			}
		);

		let tokenId = 0;
		let generated_text = "";
		const finalToolCalls: DeltaToolCall[] = [];

		async function* convertStream(): AsyncGenerator<
			TextGenerationStreamOutputWithToolsAndWebSources,
			void,
			void
		> {
			for await (const chunk of stream) {
				const token = chunk.choices?.[0]?.delta?.content || "";

				generated_text += token;

				const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];

				for (const toolCall of toolCalls) {
					const index = toolCall.index ?? 0;

					if (!finalToolCalls[index]) {
						finalToolCalls[index] = toolCall;
					} else {
						if (finalToolCalls[index].function.arguments === undefined) {
							finalToolCalls[index].function.arguments = "";
						}
						if (toolCall.function.arguments) {
							finalToolCalls[index].function.arguments += toolCall.function.arguments;
						}
					}
				}

				yield {
					token: {
						id: tokenId++,
						text: token,
						logprob: 0,
						special: false,
					},
					details: null,
					generated_text: null,
				};
			}

			let mappedToolCalls: ToolCall[] | undefined;
			try {
				if (finalToolCalls.length === 0) {
					mappedToolCalls = undefined;
				} else {
					// Ensure finalToolCalls is an array
					const toolCallsArray = Array.isArray(finalToolCalls) ? finalToolCalls : [finalToolCalls];

					mappedToolCalls = toolCallsArray.map((tc) => ({
						id: tc.id,
						name: tc.function.name ?? "",
						parameters: JSON.parse(jsonrepair(tc.function.arguments || "{}")),
					}));
				}
			} catch (e) {
				logger.error(e, "error mapping tool calls");
			}

			yield {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
					toolCalls: mappedToolCalls,
				},
				generated_text,
				details: null,
			};
		}

		return convertStream();
	};
}
