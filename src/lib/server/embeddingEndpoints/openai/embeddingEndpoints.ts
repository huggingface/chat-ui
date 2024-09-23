import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";
import { env } from "$env/dynamic/private";
import type { EmbeddingModel } from "$lib/types/EmbeddingModel";
import { decrypt } from "$lib/utils/encryption";

export const embeddingEndpointOpenAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	type: z.literal("openai"),
	url: z.string().url().default("https://api.openai.com/v1/embeddings"),
	apiKey: z.string().default(env.OPENAI_API_KEY),
	defaultHeaders: z.record(z.string()).default({}),
});

type EmbeddingEndpointOpenAIInput = z.input<typeof embeddingEndpointOpenAIParametersSchema> & {
	model: EmbeddingModel;
};

export async function embeddingEndpointOpenAI(
	input: EmbeddingEndpointOpenAIInput
): Promise<EmbeddingEndpoint> {
	const { model } = input;
	const { url, apiKey, defaultHeaders } = embeddingEndpointOpenAIParametersSchema.parse(input);

	const decryptedApiKey = decrypt(apiKey);

	const maxBatchSize = model.maxBatchSize || 100;

	return async ({ inputs }) => {
		const requestURL = new URL(url);

		const batchesInputs = chunk(inputs, maxBatchSize);

		const batchesResults = await Promise.all(
			batchesInputs.map(async (batchInputs) => {
				const response = await fetch(requestURL, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						...(decryptedApiKey ? { Authorization: `Bearer ${decryptedApiKey}` } : {}),
						...defaultHeaders,
					},
					body: JSON.stringify({ input: batchInputs, model: model.name }),
				});

				const embeddings: Embedding[] = [];
				const responseObject = await response.json();
				for (const embeddingObject of responseObject.data) {
					embeddings.push(embeddingObject.embedding);
				}
				return embeddings;
			})
		);

		const flatAllEmbeddings = batchesResults.flat();

		return flatAllEmbeddings;
	};
}
