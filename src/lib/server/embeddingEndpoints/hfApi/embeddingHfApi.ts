import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";

export const embeddingEndpointHfApiSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("hfapi"),
	authorization: z
		.string()
		.optional()
		.transform((v) => (!v && env.HF_TOKEN ? "Bearer " + env.HF_TOKEN : v)), // if the header is not set but HF_TOKEN is, use it as the authorization header
});

export async function embeddingEndpointHfApi(
	input: z.input<typeof embeddingEndpointHfApiSchema>
): Promise<EmbeddingEndpoint> {
	const { model, authorization } = embeddingEndpointHfApiSchema.parse(input);
	const url = "https://api-inference.huggingface.co/models/" + model.id;

	return async ({ inputs }) => {
		const batchesInputs = chunk(inputs, 128);

		const batchesResults = await Promise.all(
			batchesInputs.map(async (batchInputs) => {
				const response = await fetch(`${url}`, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						...(authorization ? { Authorization: authorization } : {}),
					},
					body: JSON.stringify({
						inputs: {
							source_sentence: batchInputs[0],
							sentences: batchInputs.slice(1),
						},
					}),
				});

				if (!response.ok) {
					logger.error(await response.text());
					logger.error("Failed to get embeddings from Hugging Face API", response);
					return [];
				}

				const embeddings: Embedding[] = await response.json();
				return embeddings;
			})
		);

		const flatAllEmbeddings = batchesResults.flat();

		return flatAllEmbeddings;
	};
}
