import {
	Content,
	GoogleGenerativeAI,
	HarmBlockThreshold,
	HarmCategory,
	Part,
	TextPart,
} from "@google/generative-ai";
import { z } from "zod";
import { Message, MessageFile } from "$lib/types/Message";
import { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import {
	createImageProcessorOptionsValidator,
	ImageProcessorOptions,
	makeImageProcessor,
} from "../images";

export const endpointGenAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("genai"),
	apiKey: z.string(),
	safetyThreshold: z
		.enum([
			HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED,
			HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
			HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
			HarmBlockThreshold.BLOCK_NONE,
			HarmBlockThreshold.BLOCK_ONLY_HIGH,
		])
		.optional(),
	multimodal: z
		.object({
			image: createImageProcessorOptionsValidator({
				supportedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
				preferredMimeType: "image/webp",
				// The 4 / 3 compensates for the 33% increase in size when converting to base64
				maxSizeInMB: (5 / 4) * 3,
				maxWidth: 4096,
				maxHeight: 4096,
			}),
		})
		.default({}),
});

export function endpointGenAI(input: z.input<typeof endpointGenAIParametersSchema>): Endpoint {
	const { model, apiKey, safetyThreshold, multimodal } = endpointGenAIParametersSchema.parse(input);

	const genAI = new GoogleGenerativeAI(apiKey);

	return async ({ messages, preprompt, generateSettings }) => {
		const parameters = { ...model.parameters, ...generateSettings };

		const generativeModel = genAI.getGenerativeModel({
			model: model.id ?? model.name,
			safetySettings: safetyThreshold
				? [
						{
							category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_HARASSMENT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
							threshold: safetyThreshold,
						},
						{
							category: HarmCategory.HARM_CATEGORY_UNSPECIFIED,
							threshold: safetyThreshold,
						},
				  ]
				: undefined,
			generationConfig: {
				maxOutputTokens: parameters?.max_new_tokens ?? 4096,
				stopSequences: parameters?.stop,
				temperature: parameters?.temperature ?? 1,
			},
		});

		let systemMessage = preprompt;
		if (messages[0].from === "system") {
			systemMessage = messages[0].content;
			messages.shift();
		}

		const genAIMessages = await Promise.all(
			messages.map(async ({ from, content, files }: Omit<Message, "id">): Promise<Content> => {
				return {
					role: from === "user" ? "user" : "model",
					parts: [
						...(await Promise.all(
							(files ?? []).map((file) => fileToImageBlock(file, multimodal.image))
						)),
						{ text: content },
					],
				};
			})
		);

		const result = await generativeModel.generateContentStream({
			contents: genAIMessages,
			systemInstruction:
				systemMessage && systemMessage.trim() !== ""
					? {
							role: "system",
							parts: [{ text: systemMessage }],
					  }
					: undefined,
		});

		return (async function* () {
			let tokenId = 0;
			let generatedText = "";

			for await (const data of result.stream) {
				if (!data.candidates || data.candidates.length === 0) {
					break;
				}

				const candidate = data.candidates[0];
				if (!candidate.content.parts || candidate.content.parts.length === 0) {
					continue;
				}

				const firstPart = candidate.content.parts.find((part) => "text" in part) as
					| TextPart
					| undefined;
				if (!firstPart) {
					continue;
				}

				const content = firstPart.text;
				generatedText += content;

				yield {
					token: {
						id: tokenId++,
						text: content,
						logprob: 0,
						special: false,
					},
					generated_text: null,
					details: null,
				} as TextGenerationStreamOutput;
			}

			yield {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
				},
				generated_text: generatedText,
				details: null,
			} as TextGenerationStreamOutput;
		})();
	};
}

async function fileToImageBlock(
	file: MessageFile,
	opts: ImageProcessorOptions<"image/png" | "image/jpeg" | "image/webp">
): Promise<Part> {
	const processor = makeImageProcessor(opts);
	const { image, mime } = await processor(file);

	return {
		inlineData: {
			mimeType: mime,
			data: image.toString("base64"),
		},
	};
}

export default endpointGenAI;
