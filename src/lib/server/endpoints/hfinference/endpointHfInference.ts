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

export const endpointHfInferenceParametersSchema = z.object({
	type: z.literal("hfinference"),
	weight: z.number().int().positive().default(1),
	model: z.any(),
	provider: z.enum(INFERENCE_PROVIDERS).default("hf-inference" as const),
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
});

export async function endpointHfInference(
	input: z.input<typeof endpointHfInferenceParametersSchema>
): Promise<Endpoint> {
	const { model, provider, modelName, baseURL, multimodal } =
		endpointHfInferenceParametersSchema.parse(input);

	const client = baseURL
		? new InferenceClient(config.HF_TOKEN).endpoint(baseURL)
		: new InferenceClient(config.HF_TOKEN);

	const imageProcessor = multimodal.image ? makeImageProcessor(multimodal.image) : undefined;

	return async ({ messages, generateSettings, tools, toolResults, preprompt }) => {
		const messagesArray = await Promise.all(
			messages.map(async (message) => {
				const files =
					imageProcessor && message.files
						? await Promise.all(message.files.map(imageProcessor))
						: undefined;
				return {
					role: message.from,
					content: message.content,
					files,
				};
			})
		);

		if (!model.systemRoleSupported) {
			messagesArray[0].content = preprompt + "\n" + messagesArray[0].content;
		} else if (messagesArray[0].role !== "system") {
			messagesArray.unshift({
				role: "system",
				content: preprompt ?? "",
				files: undefined,
			});
		}

		const toolCallChoices = createChatCompletionToolsArray(tools);

		const stream = client.chatCompletionStream({
			...model.parameters,
			...generateSettings,
			model: modelName ?? model.id ?? model.name,
			provider,
			messages: messagesArray,
			...(toolCallChoices.length > 0 ? { tools: toolCallChoices, tool_choice: "auto" } : {}),
			toolResults,
			use_cache: false,
		});

		let tokenId = 0;
		let generated_text = "";
		const finalToolCalls: DeltaToolCall[] = [];

		async function* convertStream(): AsyncGenerator<
			TextGenerationStreamOutputWithToolsAndWebSources,
			void,
			void
		> {
			for await (const chunk of stream) {
				if (finalToolCalls.length > 0) {
					logger.info(chunk, "chunk");
				}
				const token = chunk.choices?.[0]?.delta?.content || "";

				generated_text += token;

				const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];

				for (const toolCall of toolCalls) {
					if (!finalToolCalls[toolCall.index]) {
						finalToolCalls[toolCall.index] = toolCall;
					} else {
						if (finalToolCalls[toolCall.index].function.arguments === undefined) {
							finalToolCalls[toolCall.index].function.arguments = "";
						}
						if (toolCall.function.arguments) {
							finalToolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
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
				mappedToolCalls = finalToolCalls.map((tc) => ({
					id: tc.id,
					name: tc.function.name ?? "",
					parameters: JSON.parse(tc.function.arguments + "}"),
				}));
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
