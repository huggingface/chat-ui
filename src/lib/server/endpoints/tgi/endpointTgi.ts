import { config } from "$lib/server/config";
import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import type { Endpoint, EndpointMessage } from "../endpoints";
import { z } from "zod";
import {
	createImageProcessorOptionsValidator,
	makeImageProcessor,
	type ImageProcessor,
} from "../images";

export const endpointTgiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tgi"),
	url: z.string().url(),
	accessToken: z.string().default(config.HF_TOKEN ?? config.HF_ACCESS_TOKEN),
	authorization: z.string().optional(),
	multimodal: z
		.object({
			// Assumes IDEFICS
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				maxSizeInMB: 5,
				maxWidth: 378,
				maxHeight: 980,
			}),
		})
		.default({}),
});

export function endpointTgi(input: z.input<typeof endpointTgiParametersSchema>): Endpoint {
	const { url, accessToken, model, authorization, multimodal } =
		endpointTgiParametersSchema.parse(input);
	const imageProcessor = makeImageProcessor(multimodal.image);

	return async ({
		messages,
		preprompt,
		continueMessage,
		generateSettings,
		tools,
		toolResults,
		isMultimodal,
		conversationId,
	}) => {
		const messagesWithResizedFiles = await Promise.all(
			messages.map((message) => prepareMessage(Boolean(isMultimodal), message, imageProcessor))
		);

		const prompt = await buildPrompt({
			messages: messagesWithResizedFiles,
			preprompt,
			model,
			continueMessage,
			tools,
			toolResults,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, ...generateSettings, return_full_text: false },
				model: url,
				inputs: prompt,
				accessToken,
			},
			{
				fetch: async (endpointUrl, info) => {
					if (info && authorization && !accessToken) {
						// Set authorization header if it is defined and HF_TOKEN is empty
						info.headers = {
							...info.headers,
							Authorization: authorization,
							"ChatUI-Conversation-ID": conversationId?.toString() ?? "",
							"X-Use-Cache": "false",
						};
					}
					return fetch(endpointUrl, info);
				},
			}
		);
	};
}

async function prepareMessage(
	isMultimodal: boolean,
	message: EndpointMessage,
	imageProcessor: ImageProcessor
): Promise<EndpointMessage> {
	if (!isMultimodal) return message;
	const files = await Promise.all(message.files?.map(imageProcessor) ?? []);
	const markdowns = files.map(
		(file) => `![](data:${file.mime};base64,${file.image.toString("base64")})`
	);
	const content = message.content + "\n" + markdowns.join("\n ");

	return { ...message, content };
}
