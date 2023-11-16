import { HF_ACCESS_TOKEN } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointTgiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tgi"),
	url: z.string().url(),
	accessToken: z.string().default(HF_ACCESS_TOKEN),
});

export function endpointTgi({
	url,
	accessToken,
	model,
}: z.infer<typeof endpointTgiParametersSchema>): Endpoint {
	return async ({ conversation }) => {
		const prompt = await buildPrompt({
			messages: conversation.messages,
			webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
			preprompt: conversation.preprompt,
			model,
			id: conversation._id,
		});

		return textGenerationStream({
			parameters: { ...model.parameters, return_full_text: false },
			model: url,
			inputs: prompt,
			accessToken,
		});
	};
}

export default endpointTgi;
