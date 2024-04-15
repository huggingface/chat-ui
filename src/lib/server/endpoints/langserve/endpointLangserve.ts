import { buildPrompt } from "$lib/buildPrompt";
import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";

export const endpointLangserveParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("langserve"),
	url: z.string().url(),
});

export function endpointLangserve(
	input: z.input<typeof endpointLangserveParametersSchema>
): Endpoint {
	const { url, model } = endpointLangserveParametersSchema.parse(input);

	return async ({ messages, preprompt, continueMessage }) => {
		const prompt = await buildPrompt({
			messages,
			continueMessage,
			preprompt,
			model,
		});

		const r = await fetch(`${url}/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				input: { text: prompt },
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
				// Keep read data to check event type
				const eventData = out.value;

				// Process each complete JSON object in the accumulated data
				while (accumulatedData.includes("\n")) {
					// Assuming each JSON object ends with a newline
					const endIndex = accumulatedData.indexOf("\n");
					let jsonString = accumulatedData.substring(0, endIndex).trim();
					// Remove the processed part from the buffer

					accumulatedData = accumulatedData.substring(endIndex + 1);

					// Stopping with end event
					if (eventData.startsWith("event: end")) {
						stop = true;
						yield {
							token: {
								id: tokenId++,
								text: "",
								logprob: 0,
								special: true,
							},
							generated_text: generatedText,
							details: null,
						} satisfies TextGenerationStreamOutput;
						reader?.cancel();
						continue;
					}

					if (eventData.startsWith("event: data") && jsonString.startsWith("data: ")) {
						jsonString = jsonString.slice(6);
						let data = null;

						// Handle the parsed data
						try {
							data = JSON.parse(jsonString);
						} catch (e) {
							console.error("Failed to parse JSON", e);
							console.error("Problematic JSON string:", jsonString);
							continue; // Skip this iteration and try the next chunk
						}
						// Assuming content within data is a plain string
						if (data) {
							generatedText += data;
							const output: TextGenerationStreamOutput = {
								token: {
									id: tokenId++,
									text: data,
									logprob: 0,
									special: false,
								},
								generated_text: null,
								details: null,
							};
							yield output;
						}
					}
				}
			}
		})();
	};
}

export default endpointLangserve;
