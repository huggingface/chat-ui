import type { Tensor, Pipeline } from "@xenova/transformers";
import { pipeline, dot } from "@xenova/transformers";

// see here: https://github.com/nmslib/hnswlib/blob/359b2ba87358224963986f709e593d799064ace6/README.md?plain=1#L34
function innerProduct(tensor1: Tensor, tensor2: Tensor) {
	return 1.0 - dot(tensor1.data, tensor2.data);
}

// Use the Singleton pattern to enable lazy construction of the pipeline.
class PipelineSingleton {
	static modelId = "Xenova/gte-small";
	static instance: Promise<Pipeline> | null = null;
	static async getInstance() {
		if (this.instance === null) {
			this.instance = pipeline("feature-extraction", this.modelId);
		}
		return this.instance;
	}
}

// see https://huggingface.co/thenlper/gte-small/blob/d8e2604cadbeeda029847d19759d219e0ce2e6d8/README.md?code=true#L2625
export const MAX_SEQ_LEN = 512 as const;

export async function findSimilarSentences(
	query: string,
	sentences: string[],
	{ topK = 5 }: { topK: number }
) {
	const input = [query, ...sentences];

	const extractor = await PipelineSingleton.getInstance();
	const output: Tensor = await extractor(input, { pooling: "mean", normalize: true });

	const queryTensor: Tensor = output[0];
	const sentencesTensor: Tensor = output.slice([1, input.length - 1]);

	const distancesFromQuery: { distance: number; index: number }[] = [...sentencesTensor].map(
		(sentenceTensor: Tensor, index: number) => {
			return {
				distance: innerProduct(queryTensor, sentenceTensor),
				index: index,
			};
		}
	);

	distancesFromQuery.sort((a, b) => {
		return a.distance - b.distance;
	});

	// Return the indexes of the closest topK sentences
	return distancesFromQuery.slice(0, topK).map((item) => item.index);
}
