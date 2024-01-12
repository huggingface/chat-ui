import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";

export const embeddingEndpointTeiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tei"),
	url: z.string().url(),
	authorization: z.string().optional(),
});

const getModelInfoByUrl = async (url: string, authorization?: string) => {
	const { origin } = new URL(url);

	const response = await fetch(`${origin}/info`, {
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			...(authorization ? { Authorization: authorization } : {}),
		},
	});

	const json = await response.json();
	return json;
};

export async function embeddingEndpointTei(
	input: z.input<typeof embeddingEndpointTeiParametersSchema>
): Promise<EmbeddingEndpoint> {
	const { url, model, authorization } = embeddingEndpointTeiParametersSchema.parse(input);

	const { max_client_batch_size, max_batch_tokens } = await getModelInfoByUrl(url);
	const maxBatchSize = Math.min(
		max_client_batch_size,
		Math.floor(max_batch_tokens / model.chunkCharLength)
	);

	return async ({ inputs }) => {
		const { origin } = new URL(url);

		const batchesInputs = chunk(inputs, maxBatchSize);

		const batchesResults = await Promise.all(
			batchesInputs.map(async (batchInputs) => {
				const response = await fetch(`${origin}/embed`, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						...(authorization ? { Authorization: authorization } : {}),
					},
					body: JSON.stringify({ inputs: batchInputs, normalize: true, truncate: true }),
				});

				const embeddings: Embedding[] = await response.json();
				return embeddings;
			})
		);

		const flatAllEmbeddings = batchesResults.flat();

		return flatAllEmbeddings;
	};
}
