import { env } from "$env/dynamic/private";
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
	accessToken: z.string().default(env.HF_TOKEN ?? env.HF_ACCESS_TOKEN),
	authorization: z.string().optional(),
	multimodal: z
		.object({
			// Assumes IDEFICS
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				maxSizeInMB: 5,
				maxWidth: 224,
				maxHeight: 224,
			}),
		})
		.default({}),
});

export function endpointTgi(input: z.input<typeof endpointTgiParametersSchema>): Endpoint {
	const { url, accessToken, model, authorization, multimodal } =
		endpointTgiParametersSchema.parse(input);
	const imageProcessor = makeImageProcessor(multimodal.image);

	return async ({ messages, preprompt, continueMessage, generateSettings, isMultimodal }) => {
		const messagesWithResizedFiles = await Promise.all(
			messages.map((message) => prepareMessage(Boolean(isMultimodal), message, imageProcessor))
		);

		const prompt = await buildPrompt({
			messages: messagesWithResizedFiles,
			preprompt,
			model,
			continueMessage,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, ...generateSettings, return_full_text: false },
				model: url,
				inputs: prompt,
				accessToken,
			},
			{
				use_cache: false,
				fetch: async (endpointUrl, info) => {
					if (info && authorization && !accessToken) {
						// Set authorization header if it is defined and HF_TOKEN is empty
						info.headers = {
							...info.headers,
							Authorization: authorization,
						};
					}
					return fetch(endpointUrl, info);
				},
			}
		);
	};
}

const whiteImage = {
	mime: "image/png",
	image: Buffer.from(
		"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD+/igAoAKACgD/2Q==",
		"base64"
	),
};

async function prepareMessage(
	isMultimodal: boolean,
	message: EndpointMessage,
	imageProcessor: ImageProcessor
): Promise<EndpointMessage> {
	if (!isMultimodal) return message;

	const files = await Promise.all(message.files?.map(imageProcessor) ?? [whiteImage]);
	const markdowns = files.map(
		(file) => `![](data:${file.mime};base64,${file.image.toString("base64")})`
	);
	const content = message.content + "\n" + markdowns.join("\n ");

	return { ...message, content };
}
