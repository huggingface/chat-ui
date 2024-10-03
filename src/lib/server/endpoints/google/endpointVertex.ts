import {
	VertexAI,
	HarmCategory,
	HarmBlockThreshold,
	type Content,
	type TextPart,
} from "@google-cloud/vertexai";
import type { Endpoint } from "../endpoints";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { createImageProcessorOptionsValidator, makeImageProcessor } from "../images";

export const endpointVertexParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(), // allow optional and validate against emptiness
	type: z.literal("vertex"),
	location: z.string().default("europe-west1"),
	extraBody: z.object({ model_version: z.string() }).optional(),
	project: z.string(),
	apiEndpoint: z.string().optional(),
	safetyThreshold: z
		.enum([
			HarmBlockThreshold.HARM_BLOCK_THRESHOLD_UNSPECIFIED,
			HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
			HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
			HarmBlockThreshold.BLOCK_NONE,
			HarmBlockThreshold.BLOCK_ONLY_HIGH,
		])
		.optional(),
	tools: z.array(z.any()).optional(),
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

export function endpointVertex(input: z.input<typeof endpointVertexParametersSchema>): Endpoint {
	const { project, location, model, apiEndpoint, safetyThreshold, tools, multimodal, extraBody } =
		endpointVertexParametersSchema.parse(input);

	const vertex_ai = new VertexAI({
		project,
		location,
		apiEndpoint,
	});

	return async ({ messages, preprompt, generateSettings }) => {
		const parameters = { ...model.parameters, ...generateSettings };

		const hasFiles = messages.some((message) => message.files && message.files.length > 0);

		const generativeModel = vertex_ai.getGenerativeModel({
			model: extraBody?.model_version ?? model.id ?? model.name,
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
			// tools and multimodal are mutually exclusive
			tools: !hasFiles ? tools : undefined,
		});

		// Preprompt is the same as the first system message.
		let systemMessage = preprompt;
		if (messages[0].from === "system") {
			systemMessage = messages[0].content;
			messages.shift();
		}

		const vertexMessages = await Promise.all(
			messages.map(async ({ from, content, files }: Omit<Message, "id">): Promise<Content> => {
				const imageProcessor = makeImageProcessor(multimodal.image);
				const processedFiles =
					files && files.length > 0
						? await Promise.all(files.map(async (file) => imageProcessor(file)))
						: [];

				return {
					role: from === "user" ? "user" : "model",
					parts: [
						...processedFiles.map((processedFile) => ({
							inlineData: {
								data: processedFile.image.toString("base64"),
								mimeType: processedFile.mime,
							},
						})),
						{
							text: content,
						},
					],
				};
			})
		);

		const result = await generativeModel.generateContentStream({
			contents: vertexMessages,
			systemInstruction: systemMessage
				? {
						role: "system",
						parts: [
							{
								text: systemMessage,
							},
						],
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

				const isLastChunk = !!candidate.finishReason;

				const content = firstPart.text;
				generatedText += content;
				const output: TextGenerationStreamOutput = {
					token: {
						id: tokenId++,
						text: content,
						logprob: 0,
						special: isLastChunk,
					},
					generated_text: isLastChunk ? generatedText : null,
					details: null,
				};
				yield output;

				if (isLastChunk) break;
			}
		})();
	};
}
export default endpointVertex;
