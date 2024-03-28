import { VertexAI, HarmCategory, HarmBlockThreshold } from "@google-cloud/vertexai";
import { buildPrompt } from "$lib/buildPrompt";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointVertexParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(), // allow optional and validate against emptiness
	type: z.literal("vertex"),
	location: z.string().default("europe-west1"),
	project: z.string(),
	apiEndpoint: z.string().optional(),
});

export function endpointVertex(input: z.input<typeof endpointVertexParametersSchema>): Endpoint {
	const { project, location, model, apiEndpoint } = endpointVertexParametersSchema.parse(input);

	const vertex_ai = new VertexAI({
		project,
		location,
		apiEndpoint,
	});

	const generativeModel = vertex_ai.getGenerativeModel({
		model: model.id ?? model.name,
		safety_settings: [
			{
				category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
				threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
			},
		],
		generation_config: {},
	});

	return async ({ messages, preprompt, continueMessage }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		const chat = generativeModel.startChat();
		const result = await chat.sendMessageStream(prompt);
		let tokenId = 0;

		return (async function* () {
			let generatedText = "";

			for await (const data of result.stream) {
				if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
					const firstPart = data.candidates[0].content.parts[0];
					if ("text" in firstPart) {
						const content = firstPart.text;
						generatedText += content;
						const output: TextGenerationStreamOutput = {
							token: {
								id: tokenId++,
								text: content ?? "",
								logprob: 0,
								special: false,
							},
							generated_text: generatedText,
							details: null,
						};
						yield output;
					}

					if (!data.candidates.slice(-1)[0].finishReason) break;
				} else {
					break;
				}
			}
		})();
	};
}
export default endpointVertex;
