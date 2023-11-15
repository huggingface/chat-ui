import { HF_ACCESS_TOKEN } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointLlamacppParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("llamacpp"),
	url: z.string().url(),
	accessToken: z.string().min(1).default(HF_ACCESS_TOKEN),
});

export function endpointLlamacpp({
	url,
	model,
}: z.infer<typeof endpointLlamacppParametersSchema>): Endpoint {
	return async ({ conversation }) => {
		const prompt = await buildPrompt({
			messages: conversation.messages,
			webSearch: conversation.messages[conversation.messages.length - 1].webSearch,
			preprompt: conversation.preprompt,
			model,
		});

		const r = await fetch(`${url}/completion`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				prompt,
				stream: true,
				temperature: model.parameters.temperature,
				top_p: model.parameters.top_p,
				top_k: model.parameters.top_k,
				stop: model.parameters.stop,
				repeat_penalty: model.parameters.repetition_penalty,
				n_predict: model.parameters.max_new_tokens,
			}),
		});

		if (!r.ok) {
			throw new Error(`Failed to generate text: ${await r.text()}`);
		}

		const encoder = new TextDecoderStream();
		const reader = r.body?.pipeThrough(encoder).getReader();

		return (async function* () {
			let stop = false;
			let generatedText = "";
			let tokenId = 0;
			while (!stop) {
				// read the stream and log the outputs to console
				const out = (await reader?.read()) ?? { done: false, value: undefined };
				// we read, if it's done we cancel
				if (out.done) {
					reader?.cancel();
					return;
				}

				if (!out.value) {
					return;
				}

				if (out.value.startsWith("data: ")) {
					let data = null;
					try {
						data = JSON.parse(out.value.slice(6));
					} catch (e) {
						return;
					}
					if (data.content || data.stop) {
						generatedText += data.content;
						const output: TextGenerationStreamOutput = {
							token: {
								id: tokenId++,
								text: data.content ?? "",
								logprob: 0,
								special: false,
							},
							generated_text: data.stop ? generatedText : null,
							details: null,
						};
						if (data.stop) {
							stop = true;
							reader?.cancel();
						}
						yield output;
						// take the data.content value and yield it
					}
				}
			}
		})();
	};
}

export default endpointLlamacpp;
