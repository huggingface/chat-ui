import { z } from "zod";
import type { Endpoint, TextGenerationStreamOutputWithToolsAndWebSources } from "../endpoints";
import { createImageProcessorOptionsValidator } from "../images";
import { INFERENCE_PROVIDERS, InferenceClient } from "@huggingface/inference";
import { config } from "$lib/server/config";
import type { ToolCall } from "$lib/types/Tool";
import type { ChatCompletionInputTool } from "@huggingface/mcp-client";

export const endpointHfInferenceParametersSchema = z.object({
	type: z.literal("hfinference"),
	weight: z.number().int().positive().default(1),
	model: z.any(),
	provider: z.enum(INFERENCE_PROVIDERS).default("hf-inference" as const),
	modelName: z.string().optional(),
	endpointUrl: z.string().optional(),
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
	const { model, provider, modelName, endpointUrl } =
		endpointHfInferenceParametersSchema.parse(input);

	let client;
	if (endpointUrl) {
		client = new InferenceClient(config.HF_TOKEN).endpoint(endpointUrl);
	} else {
		client = new InferenceClient(config.HF_TOKEN);
	}

	return async ({ messages, generateSettings, tools, toolResults }) => {
		const messagesArray = messages.map((message) => ({
			role: message.from === "user" ? "user" : "assistant",
			content: message.content,
		}));

		const toolsArray = tools?.map(
			(tool) =>
				({
					id: tool.id,
					name: tool.name,
					description: tool.description,
					function: tool.function,
				}) satisfies ChatCompletionInputTool
		);

		const stream = client.chatCompletionStream({
			...model.parameters,
			...generateSettings,
			model: modelName ?? model.id ?? model.name,
			provider,
			messages: messagesArray,
			tool_choice: "auto",
			tools,
			toolResults,
			use_cache: false,
		});

		let tokenId = 0;
		async function* convertStream(): AsyncGenerator<
			TextGenerationStreamOutputWithToolsAndWebSources,
			void,
			void
		> {
			for await (const chunk of stream) {
				const toolCalls =
					chunk.choices?.[0]?.delta?.tool_calls?.map(
						(tc) =>
							({
								id: tc.id,
								name: tc.function?.name,
								parameters: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
							}) as ToolCall
					) || undefined;

				const output: TextGenerationStreamOutputWithToolsAndWebSources = {
					token: {
						id: tokenId++,
						text: chunk.choices?.[0]?.delta?.content || "",
						logprob: 0,
						special: chunk.choices?.[0]?.finish_reason === "stop",
						toolCalls,
					},
					generated_text:
						chunk.choices?.[0]?.finish_reason === "stop"
							? (chunk.choices?.[0]?.delta?.content ?? null)
							: null,
					details: null,
				};
				yield output;
			}
		}

		return convertStream();
	};
}
