import { z } from "zod";
import type { EmbeddingEndpoint } from "../embeddingEndpoints";
import type { Tensor, FeatureExtractionPipeline } from "@huggingface/transformers";
import { pipeline } from "@huggingface/transformers";
import type { EmbeddingModel } from "$lib/types/EmbeddingModel";

export const embeddingEndpointTransformersJSParametersSchema = z.object({
	weight: z.number().int().positive().default(1),
	type: z.literal("transformersjs"),
});

// Use the Singleton pattern to enable lazy construction of the pipeline.
class TransformersJSModelsSingleton {
	static instances: Array<[string, Promise<FeatureExtractionPipeline>]> = [];

	static async getInstance(modelName: string): Promise<FeatureExtractionPipeline> {
		const modelPipelineInstance = this.instances.find(([name]) => name === modelName);

		if (modelPipelineInstance) {
			const [, modelPipeline] = modelPipelineInstance;
			// dispose of the previous pipeline to clear memory
			await (await modelPipeline).dispose();
			this.instances = this.instances.filter(([name]) => name !== modelName);
		}
		const newModelPipeline = pipeline("feature-extraction", modelName);
		this.instances.push([modelName, newModelPipeline]);

		return newModelPipeline;
	}
}

export async function calculateEmbedding(modelName: string, inputs: string[]) {
	const extractor = await TransformersJSModelsSingleton.getInstance(modelName);
	const output: Tensor = await extractor(inputs, { pooling: "mean", normalize: true });

	return output.tolist();
}

type EmbeddingEndpointTransformersJSInput = z.input<
	typeof embeddingEndpointTransformersJSParametersSchema
> & {
	model: EmbeddingModel;
};

export function embeddingEndpointTransformersJS(
	input: EmbeddingEndpointTransformersJSInput
): EmbeddingEndpoint {
	const { model } = input;

	return async ({ inputs }) => {
		return calculateEmbedding(model.name, inputs);
	};
}
