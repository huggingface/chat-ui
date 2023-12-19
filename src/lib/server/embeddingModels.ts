import {
	TEXT_EMBEDDING_MODELS,
} from "$env/static/private";

import { z } from "zod";
import { sum } from "$lib/utils/sum";
import embeddingEndpoints, { embeddingEndpointSchema, type EmbeddingEndpoint } from "./embeddingEndpoints/embeddingEndpoints";
import embeddingEndpointXenova from "./embeddingEndpoints/xenova/embeddingEndpoints";

const modelConfig = z.object({
	/** Used as an identifier in DB */
	id: z.string().optional(),
	/** Used to link to the model page, and for inference */
	name: z.string().min(1),
	displayName: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	websiteUrl: z.string().url().optional(),
	modelUrl: z.string().url().optional(),
	endpoints: z.array(embeddingEndpointSchema).optional(),
	maxSequenceLength: z.number().positive(),
});

const embeddingModelsRaw = z.array(modelConfig).parse(JSON.parse(TEXT_EMBEDDING_MODELS));

const processEmbeddingModel = async (m: z.infer<typeof modelConfig>) => ({
	...m,
	id: m.id || m.name,
});

const addEndpoint = (m: Awaited<ReturnType<typeof processEmbeddingModel>>) => ({
	...m,
	getEndpoint: async (): Promise<EmbeddingEndpoint> => {
		if (!m.endpoints) {
			return embeddingEndpointXenova({
				type: "xenova",
				weight: 1,
				model: m,
			});
		}

		const totalWeight = sum(m.endpoints.map((e) => e.weight));

		let random = Math.random() * totalWeight;

		for (const endpoint of m.endpoints) {
			if (random < endpoint.weight) {
				const args = { ...endpoint, model: m };

				switch (args.type) {
					case "tei":
						return embeddingEndpoints.tei(args);
					case "xenova":
						return embeddingEndpoints.xenova(args);
				}
			}

			random -= endpoint.weight;
		}

		throw new Error(`Failed to select endpoint`);
	},
});

export const embeddingModels = await Promise.all(embeddingModelsRaw.map((e) => processEmbeddingModel(e).then(addEndpoint)));

export const defaultEmbeddingModel = embeddingModels[0];

export const validateEmbeddingModel = (_models: EmbeddingBackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};


export type EmbeddingBackendModel = typeof defaultEmbeddingModel;
