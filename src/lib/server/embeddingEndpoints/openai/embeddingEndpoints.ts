import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";
import { OPENAI_API_KEY } from "$env/static/private";

export const embeddingEndpointOpenAIParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("openai"),
	url: z.string().url(),
	authorization: z.string().default(`Bearer ${OPENAI_API_KEY}`),
});

export async function embeddingEndpointOpenAI(
	input: z.input<typeof embeddingEndpointOpenAIParametersSchema>
): Promise<EmbeddingEndpoint> {
	const { url, model, authorization } = embeddingEndpointOpenAIParametersSchema.parse(input);

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
						...(authorization ? { Authorization: authorization } : {}),
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
