import { HF_ACCESS_TOKEN, CUSTOM_AUTHORIZATION_TOKEN } from "$env/static/private";
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
	authorization: z.string().default(CUSTOM_AUTHORIZATION_TOKEN),
});

export function endpointTgi({
	url,
	accessToken,
	model,
	authorization,
}: z.infer<typeof endpointTgiParametersSchema>): Endpoint {
	return async ({ conversation }) => {
		const prompt = await buildPrompt({
			messages: conversation.messages,
			webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
			preprompt: conversation.preprompt,
			model,
			id: conversation._id,
		});

		return textGenerationStream(
			{
				parameters: { ...model.parameters, return_full_text: false },
				model: url,
				inputs: prompt,
				accessToken,
			},
			{
				use_cache: false,
				fetch: async (url, info) => {
					// authEmpty can be skipped
					let authEmpty = typeof authorization === 'string' && authorization.length === 0;
					let hfTokenEmpty = typeof accessToken === 'string' && accessToken.length === 0;
					if (info && !authEmpty && hfTokenEmpty) {
						// Set authorization header if it is defined and HF_ACCESS_TOKEN is empty
						if (info.headers) {
							info.headers.Authorization = authorization;
						} else {
							info.headers = {"Authorization": authorization};
						}
					}
					return fetch(url, info)
				}
			}
		);
	};
}

export default endpointTgi;
