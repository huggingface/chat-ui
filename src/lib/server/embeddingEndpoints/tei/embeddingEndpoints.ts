import { z } from "zod";
import type { EmbeddingEndpoint } from "$lib/types/EmbeddingEndpoints";
import { chunk } from "$lib/utils/chunk";

export const embeddingEndpointTeiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tei"),
	url: z.string().url(),
});

const getModelInfoByUrl = async (url: string) => {
	const { origin } = new URL(url);

	const response = await fetch(`${origin}/info`, {
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	});

	const info = await response.json();

	return info;
};

export async function embeddingEndpointTei(
	input: z.input<typeof embeddingEndpointTeiParametersSchema>
): Promise<EmbeddingEndpoint> {
	const { url, model } = embeddingEndpointTeiParametersSchema.parse(input);

	const { max_client_batch_size, max_batch_tokens } = await getModelInfoByUrl(url);
	const maxBatchSize = Math.min(
		max_client_batch_size,
		Math.floor(max_batch_tokens / model.maxSequenceLength)
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
					},
					body: JSON.stringify({ inputs: batchInputs, normalize: true, truncate: true }),
				});

				const embeddings: number[][] = await response.json();
				return embeddings;
			})
		);

		const flatAllEmbeddings = batchesResults.flat();

		return flatAllEmbeddings;
	};
}
