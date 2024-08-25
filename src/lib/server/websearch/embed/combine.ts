import type { EmbeddingBackendModel } from "$lib/server/embeddingModels";
import { getSentenceSimilarity } from "$lib/server/sentenceSimilarity";

/**
 * Combines sentences together to reach the maximum character limit of the embedding model
 * Improves performance considerably when using CPU embedding
 */
export async function getCombinedSentenceSimilarity(
	embeddingModel: EmbeddingBackendModel,
	query: string,
	sentences: string[]
): ReturnType<typeof getSentenceSimilarity> {
	const combinedSentences = sentences.reduce<{ text: string; indices: number[] }[]>(
		(acc, sentence, idx) => {
			const lastSentence = acc[acc.length - 1];
			if (!lastSentence) return [{ text: sentence, indices: [idx] }];
			if (lastSentence.text.length + sentence.length < embeddingModel.chunkCharLength) {
				lastSentence.text += ` ${sentence}`;
				lastSentence.indices.push(idx);
				return acc;
			}
			return [...acc, { text: sentence, indices: [idx] }];
		},
		[]
	);

	const embeddings = await getSentenceSimilarity(
		embeddingModel,
		query,
		combinedSentences.map(({ text }) => text)
	);

	return embeddings.flatMap((embedding, idx) => {
		const { indices } = combinedSentences[idx];
		return indices.map((i) => ({ ...embedding, idx: i }));
	});
}
