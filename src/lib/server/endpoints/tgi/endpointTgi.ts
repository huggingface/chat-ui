import { HF_ACCESS_TOKEN, HF_TOKEN } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import { textGenerationStream } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointTgiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tgi"),
	url: z.string().url(),
	accessToken: z.string().default(HF_TOKEN ?? HF_ACCESS_TOKEN),
	authorization: z.string().optional(),
});

export function endpointTgi(input: z.input<typeof endpointTgiParametersSchema>): Endpoint {
	const { url, accessToken, model, authorization } = endpointTgiParametersSchema.parse(input);

	return async ({ conversation, continue: messageContinue }) => {
		let prompt = await buildPrompt({
			messages: conversation.messages,
			webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
			preprompt: conversation.preprompt,
			model,
			id: conversation._id,
		});

		if (messageContinue) {
			// start with the full prompt, and for each stop token, try to remove it from the end of the prompt
			prompt = model.parameters.stop.reduce((acc: string, curr: string) => {
				if (acc.endsWith(curr)) {
					return acc.slice(0, acc.length - curr.length);
				}
				return acc;
			}, prompt.trimEnd());
		}

		return textGenerationStream(
			{
				parameters: { ...model.parameters, return_full_text: false },
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

export default endpointTgi;
