import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";
import { env } from "$env/dynamic/private";
import { logger } from "$lib/server/logger";
import type { EmbeddingModel } from "$lib/types/EmbeddingModel";
import { decrypt } from "$lib/utils/encryption";

export const embeddingEndpointHfApiSchema = z.object({
	weight: z.number().int().positive().default(1),
	type: z.literal("hfapi"),
	authorization: z
		.string()
		.optional()
		.transform((v) => (!v && env.HF_TOKEN ? "Bearer " + env.HF_TOKEN : v)), // if the header is not set but HF_TOKEN is, use it as the authorization header
});

type EmbeddingEndpointHfApiInput = z.input<typeof embeddingEndpointHfApiSchema> & {
	model: EmbeddingModel;
};

export async function embeddingEndpointHfApi(
	input: EmbeddingEndpointHfApiInput
): Promise<EmbeddingEndpoint> {
	const { model } = input;
	const { authorization } = embeddingEndpointHfApiSchema.parse(input);

	const decryptedAuthorization = authorization && decrypt(authorization);

	const url = "https://api-inference.huggingface.co/models/" + model.name;

	return async ({ inputs }) => {
		const batchesInputs = chunk(inputs, 128);

		const batchesResults = await Promise.all(
			batchesInputs.map(async (batchInputs) => {
				const response = await fetch(`${url}`, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						...(decryptedAuthorization ? { Authorization: decryptedAuthorization } : {}),
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
					logger.error(response, "Failed to get embeddings from Hugging Face API");
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
