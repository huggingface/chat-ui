import { dot } from "@xenova/transformers";
import type { EmbeddingBackendModel } from "$lib/server/embeddingModels";
import type { Embedding } from "$lib/server/embeddingEndpoints/embeddingEndpoints";

// see here: https://github.com/nmslib/hnswlib/blob/359b2ba87358224963986f709e593d799064ace6/README.md?plain=1#L34
function innerProduct(embeddingA: Embedding, embeddingB: Embedding) {
	return 1.0 - dot(embeddingA, embeddingB);
}

export async function findSimilarSentences(
	embeddingModel: EmbeddingBackendModel,
	query: string,
	sentences: string[],
	{ topK = 5 }: { topK: number }
): Promise<Embedding> {
	const inputs = [
		`${embeddingModel.preQuery}${query}`,
		...sentences.map((sentence) => `${embeddingModel.prePassage}${sentence}`),
	];

	const embeddingEndpoint = await embeddingModel.getEndpoint();
	const output = await embeddingEndpoint({ inputs });

	const queryEmbedding: Embedding = output[0];
	const sentencesEmbeddings: Embedding[] = output.slice(1, inputs.length - 1);

	const distancesFromQuery: { distance: number; index: number }[] = [...sentencesEmbeddings].map(
		(sentenceEmbedding: Embedding, index: number) => {
			return {
				distance: innerProduct(queryEmbedding, sentenceEmbedding),
				index,
			};
		}
	);

	distancesFromQuery.sort((a, b) => {
		return a.distance - b.distance;
	});

	// Return the indexes of the closest topK sentences
	return distancesFromQuery.slice(0, topK).map((item) => item.index);
}
