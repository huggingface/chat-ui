import { z } from "zod";
import type { EmbeddingEndpoint, Embedding } from "../embeddingEndpoints";
import { chunk } from "$lib/utils/chunk";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";

export const embeddingEndpointTeiParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("tei"),
	url: z.string().url(),
	authorization: z
		.string()
		.optional()
		.transform((v) => (!v && config.HF_TOKEN ? "Bearer " + config.HF_TOKEN : v)), // if the header is not set but HF_TOKEN is, use it as the authorization header
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

	try {
		const json = await response.json();
		return { max_client_batch_size: 32, max_batch_tokens: 16384, ...json };
	} catch {
		logger.debug("Could not get info from TEI embedding endpoint. Using defaults.");
		return { max_client_batch_size: 32, max_batch_tokens: 16384 };
	}
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
