import { z } from "zod";
import type { EmbeddingEndpoint } from "../embeddingEndpoints";
import type { Tensor, Pipeline } from "@xenova/transformers";
import { pipeline } from "@xenova/transformers";

export const embeddingEndpointXenovaParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	model: z.any(),
	type: z.literal("xenova"),
});

// Use the Singleton pattern to enable lazy construction of the pipeline.
class XenovaModelsSingleton {
	static instances: Array<[string, Promise<Pipeline>]> = [];

	static async getInstance(modelName: string): Promise<Pipeline> {
		const modelPipeline = this.instances.find(([name]) => name === modelName);

		if (modelPipeline) {
			return modelPipeline[1];
		}

		const newModelPipeline = pipeline("feature-extraction", modelName);
		this.instances.push([modelName, newModelPipeline]);

		return newModelPipeline;
	}
}

export async function calculateEmbedding(modelName: string, inputs: string[]) {
	const extractor = await XenovaModelsSingleton.getInstance(modelName);
	const output: Tensor = await extractor(inputs, { pooling: "mean", normalize: true });

	return output.tolist();
}

export function embeddingEndpointXenova(
	input: z.input<typeof embeddingEndpointXenovaParametersSchema>
): EmbeddingEndpoint {
	const { model } = embeddingEndpointXenovaParametersSchema.parse(input);

	return async ({ inputs }) => {
		return calculateEmbedding(model.name, inputs);
	};
}

export default embeddingEndpointXenova;
