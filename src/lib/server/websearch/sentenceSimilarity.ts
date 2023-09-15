import type { Tensor } from "@xenova/transformers";
import { pipeline, dot } from "@xenova/transformers";

// see here: https://github.com/nmslib/hnswlib/blob/359b2ba87358224963986f709e593d799064ace6/README.md?plain=1#L34
function innerProduct(tensor1: Tensor, tensor2: Tensor) {
	return 1.0 - dot(tensor1.data, tensor2.data);
}

const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
const queryInstruction = "Represent this sentence for searching relevant passages: ";

export async function findSimilarSentences(
	query: string,
	sentences: string[],
	{ topK = 5 }: { topK: number }
) {
	query = queryInstruction + query;
	const input = [query, ...sentences];
	let output: Tensor = await extractor(input, { pooling: "none", normalize: true });
	output = output.slice(null, 0); // CLS pooling

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
