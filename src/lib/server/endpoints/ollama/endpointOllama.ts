import { buildPrompt } from "$lib/buildPrompt";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointOllamaParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("ollama"),
	url: z.string().url().default("http://127.0.0.1:11434"),
	ollamaName: z.string().min(1).optional(),
});

export function endpointOllama(input: z.input<typeof endpointOllamaParametersSchema>): Endpoint {
	const { url, model, ollamaName } = endpointOllamaParametersSchema.parse(input);

	return async ({ messages, preprompt, continueMessage }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		const r = await fetch(`${url}/api/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				prompt,
				model: ollamaName ?? model.name,
				raw: true,
				options: {
					top_p: model.parameters.top_p,
					top_k: model.parameters.top_k,
					temperature: model.parameters.temperature,
					repeat_penalty: model.parameters.repetition_penalty,
					stop: model.parameters.stop,
					num_predict: model.parameters.max_new_tokens,
				},
			}),
		});

		if (!r.ok) {
			throw new Error(`Failed to generate text: ${await r.text()}`);
		}

		const encoder = new TextDecoderStream();
		const reader = r.body?.pipeThrough(encoder).getReader();

		return (async function* () {
			let generatedText = "";
			let tokenId = 0;
			let stop = false;
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

				let data = null;
				try {
					data = JSON.parse(out.value);
				} catch (e) {
					return;
				}
				if (!data.done) {
					generatedText += data.response;

					yield {
						token: {
							id: tokenId++,
							text: data.response ?? "",
							logprob: 0,
							special: false,
						},
						generated_text: null,
						details: null,
					} satisfies TextGenerationStreamOutput;
				} else {
					stop = true;
					yield {
						token: {
							id: tokenId++,
							text: data.response ?? "",
							logprob: 0,
							special: true,
						},
						generated_text: generatedText,
						details: null,
					} satisfies TextGenerationStreamOutput;
				}
			}
		})();
	};
}

export default endpointOllama;
