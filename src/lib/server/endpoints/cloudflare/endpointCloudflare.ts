import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";

export const endpointCloudflareParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("cloudflare"),
	accountId: z.string().default(config.CLOUDFLARE_ACCOUNT_ID),
	apiToken: z.string().default(config.CLOUDFLARE_API_TOKEN),
});

export async function endpointCloudflare(
	input: z.input<typeof endpointCloudflareParametersSchema>
): Promise<Endpoint> {
	const { accountId, apiToken, model } = endpointCloudflareParametersSchema.parse(input);

	if (!model.id.startsWith("@")) {
		model.id = "@hf/" + model.id;
	}

	const apiURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model.id}`;

	return async ({ messages, preprompt, generateSettings }) => {
		let messagesFormatted = messages.map((message) => ({
			role: message.from,
			content: message.content,
		}));

		if (messagesFormatted?.[0]?.role !== "system") {
			messagesFormatted = [{ role: "system", content: preprompt ?? "" }, ...messagesFormatted];
		}

		const parameters = { ...model.parameters, ...generateSettings };

		const payload = JSON.stringify({
			messages: messagesFormatted,
			stream: true,
			max_tokens: parameters?.max_new_tokens,
			temperature: parameters?.temperature,
			top_p: parameters?.top_p,
			top_k: parameters?.top_k,
			repetition_penalty: parameters?.repetition_penalty,
		});

		const res = await fetch(apiURL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
			body: payload,
		});

		if (!res.ok) {
			throw new Error(`Failed to generate text: ${await res.text()}`);
		}

		const encoder = new TextDecoderStream();
		const reader = res.body?.pipeThrough(encoder).getReader();

		return (async function* () {
			let stop = false;
			let generatedText = "";
			let tokenId = 0;
			let accumulatedData = ""; // Buffer to accumulate data chunks

			while (!stop) {
				const out = await reader?.read();

				// If it's done, we cancel
				if (out?.done) {
					reader?.cancel();
					return;
				}

				if (!out?.value) {
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

						if (jsonString === "[DONE]") {
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

						try {
							data = JSON.parse(jsonString);
						} catch (e) {
							logger.error(e, "Failed to parse JSON");
							logger.error(jsonString, "Problematic JSON string:");
							continue; // Skip this iteration and try the next chunk
						}

						// Handle the parsed data
						if (data.response) {
							generatedText += data.response ?? "";
							const output: TextGenerationStreamOutput = {
								token: {
									id: tokenId++,
									text: data.response ?? "",
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

export default endpointCloudflare;
