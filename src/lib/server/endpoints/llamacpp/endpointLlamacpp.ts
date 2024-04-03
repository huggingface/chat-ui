import { HF_ACCESS_TOKEN, HF_TOKEN } from "$env/static/private";
import { buildPrompt } from "$lib/buildPrompt";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import type { Endpoint } from "../endpoints";
import { z } from "zod";

export const endpointLlamacppParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("llamacpp"),
	url: z.string().url().default("http://127.0.0.1:8080"),
	accessToken: z
		.string()
		.min(1)
		.default(HF_TOKEN ?? HF_ACCESS_TOKEN),
});

export function endpointLlamacpp(
	input: z.input<typeof endpointLlamacppParametersSchema>
): Endpoint {
	const { url, model } = endpointLlamacppParametersSchema.parse(input);
	return async ({ messages, preprompt, continueMessage, generateSettings }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		const parameters = { ...model.parameters, ...generateSettings };

		const r = await fetch(`${url}/completion`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				prompt,
				stream: true,
				temperature: parameters.temperature,
				top_p: parameters.top_p,
				top_k: parameters.top_k,
				stop: parameters.stop,
				repeat_penalty: parameters.repetition_penalty,
				n_predict: parameters.max_new_tokens,
				cache_prompt: true,
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
			let accumulatedData = ""; // Buffer to accumulate data chunks

			while (!stop) {
				// Read the stream and log the outputs to console
				const out = (await reader?.read()) ?? { done: false, value: undefined };

				// If it's done, we cancel
				if (out.done) {
					reader?.cancel();
					return;
				}

				if (!out.value) {
					return;
				}

				// Accumulate the data chunk
				accumulatedData += out.value;

				// Process each complete JSON object in the accumulated data
				while (accumulatedData.includes("\n")) {
					// Assuming each JSON object ends with a newline
					const endIndex = accumulatedData.indexOf("\n");
					let jsonString = accumulatedData.substring(0, endIndex).trim();

					// Remove the processed part from the buffer
					accumulatedData = accumulatedData.substring(endIndex + 1);

					if (jsonString.startsWith("data: ")) {
						jsonString = jsonString.slice(6);
						let data = null;

						try {
							data = JSON.parse(jsonString);
						} catch (e) {
							console.error("Failed to parse JSON", e);
							console.error("Problematic JSON string:", jsonString);
							continue; // Skip this iteration and try the next chunk
						}

						// Handle the parsed data
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
								output.token.special = true;
								reader?.cancel();
							}
							yield output;
						}
					}
				}
			}
		})();
	};
}

export default endpointLlamacpp;
