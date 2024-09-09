import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import type { Content, Part, SafetySetting, TextPart } from "@google/generative-ai";
import { z } from "zod";
import type { Message, MessageFile } from "$lib/types/Message";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";
import type { ImageProcessorOptions } from "../images";
import { env } from "$env/dynamic/private";

export const endpointGenAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("genai"),
	apiKey: z.string().default(env.GOOGLE_GENAI_API_KEY),
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

	const safetySettings = safetyThreshold
		? Object.keys(HarmCategory)
				.filter((cat) => cat !== HarmCategory.HARM_CATEGORY_UNSPECIFIED)
				.reduce((acc, val) => {
					acc.push({
						category: val as HarmCategory,
						threshold: safetyThreshold,
					});
					return acc;
				}, [] as SafetySetting[])
		: undefined;

	return async ({ messages, preprompt, generateSettings }) => {
		const parameters = { ...model.parameters, ...generateSettings };

		const generativeModel = genAI.getGenerativeModel({
			model: model.id ?? model.name,
			safetySettings,
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

		let tokenId = 0;
		return (async function* () {
			let generatedText = "";

			for await (const data of result.stream) {
				if (!data?.candidates?.length) break; // Handle case where no candidates are present

				const candidate = data.candidates[0];
				if (!candidate.content?.parts?.length) continue; // Skip if no parts are present

				const firstPart = candidate.content.parts.find((part) => "text" in part) as
					| TextPart
					| undefined;
				if (!firstPart) continue; // Skip if no text part is found

				const content = firstPart.text;
				generatedText += content;

				const output: TextGenerationStreamOutput = {
					token: {
						id: tokenId++,
						text: content,
						logprob: 0,
						special: false,
					},
					generated_text: null,
					details: null,
				};
				yield output;
			}

			const output: TextGenerationStreamOutput = {
				token: {
					id: tokenId++,
					text: "",
					logprob: 0,
					special: true,
				},
				generated_text: generatedText,
				details: null,
			};
			yield output;
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
