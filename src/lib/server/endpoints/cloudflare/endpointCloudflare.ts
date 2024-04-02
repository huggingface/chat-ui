import { z } from "zod";
import type { Endpoint } from "../endpoints";
import type { TextGenerationStreamOutput } from "@huggingface/inference";
import { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN } from "$env/static/private";

export const endpointCloudflareParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("cloudflare"),
	accountId: z.string().default(CLOUDFLARE_ACCOUNT_ID),
	apiToken: z.string().default(CLOUDFLARE_API_TOKEN),
});

export async function endpointCloudflare(
	input: z.input<typeof endpointCloudflareParametersSchema>
): Promise<Endpoint> {
	const { accountId, apiToken, model } = endpointCloudflareParametersSchema.parse(input);
	const apiURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@hf/${model.id}`;

	return async ({ messages, preprompt }) => {
		let messagesFormatted = messages.map((message) => ({
			role: message.from,
			content: message.content,
		}));

		if (messagesFormatted?.[0]?.role !== "system") {
			messagesFormatted = [{ role: "system", content: preprompt ?? "" }, ...messagesFormatted];
		}

		const payload = JSON.stringify({
			messages: messagesFormatted,
			stream: true,
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
							console.error("Failed to parse JSON", e);
							console.error("Problematic JSON string:", jsonString);
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
