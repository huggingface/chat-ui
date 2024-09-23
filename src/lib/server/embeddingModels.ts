import { env } from "$env/dynamic/private";

import { z } from "zod";
import { sum } from "$lib/utils/sum";
import {
	embeddingEndpoints,
	embeddingEndpointSchema,
} from "$lib/server/embeddingEndpoints/embeddingEndpoints";
import { embeddingEndpointTransformersJS } from "$lib/server/embeddingEndpoints/transformersjs/embeddingEndpoints";

import JSON5 from "json5";
import type { EmbeddingModel } from "$lib/types/EmbeddingModel";
import { collections } from "./database";
import { ObjectId } from "mongodb";
import { encrypt } from "$lib/utils/encryption";

const modelConfig = z.object({
	/** Used as an identifier in DB */
	id: z.string().optional(),
	/** Used to link to the model page, and for inference */
	name: z.string().min(1),
	displayName: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	websiteUrl: z.string().url().optional(),
	modelUrl: z.string().url().optional(),
	endpoints: z.array(embeddingEndpointSchema).nonempty(),
	chunkCharLength: z.number().positive(),
	maxBatchSize: z.number().positive().optional(),
	preQuery: z.string().default(""),
	prePassage: z.string().default(""),
});

// Default embedding model for backward compatibility
const rawEmbeddingModelJSON =
	env.TEXT_EMBEDDING_MODELS ||
	`[
	{
	  "name": "Xenova/gte-small",
	  "chunkCharLength": 512,
	  "endpoints": [
		{ "type": "transformersjs" }
	  ]
	}
]`;

const embeddingModelsRaw = z.array(modelConfig).parse(JSON5.parse(rawEmbeddingModelJSON));

const encryptEndpoints = (endpoints: z.infer<typeof modelConfig>["endpoints"]) =>
	endpoints.map((endpoint) => {
		switch (endpoint.type) {
			case "openai":
				return {
					...endpoint,
					apiKey: encrypt(endpoint.apiKey),
				};
			case "tei":
				return {
					...endpoint,
					authorization: endpoint.authorization && encrypt(endpoint.authorization),
				};
			case "hfapi":
				return {
					...endpoint,
					authorization: endpoint.authorization && encrypt(endpoint.authorization),
				};
			default:
				return endpoint;
		}
	});

const embeddingModels = embeddingModelsRaw.map((rawEmbeddingModel) => {
	const embeddingModel: EmbeddingModel = {
		name: rawEmbeddingModel.name,
		description: rawEmbeddingModel.description,
		websiteUrl: rawEmbeddingModel.websiteUrl,
		modelUrl: rawEmbeddingModel.modelUrl,
		chunkCharLength: rawEmbeddingModel.chunkCharLength,
		maxBatchSize: rawEmbeddingModel.maxBatchSize,
		preQuery: rawEmbeddingModel.preQuery,
		prePassage: rawEmbeddingModel.prePassage,
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		endpoints: encryptEndpoints(rawEmbeddingModel.endpoints),
	};

	return embeddingModel;
});

export const getEmbeddingEndpoint = async (embeddingModel: EmbeddingModel) => {
	if (!embeddingModel.endpoints) {
		return embeddingEndpointTransformersJS({
			type: "transformersjs",
			weight: 1,
			model: embeddingModel,
		});
	}

	const totalWeight = sum(embeddingModel.endpoints.map((e) => e.weight));

	let random = Math.random() * totalWeight;

	for (const endpoint of embeddingModel.endpoints) {
		if (random < endpoint.weight) {
			const args = { ...endpoint, model: embeddingModel };

			switch (args.type) {
				case "tei":
					return embeddingEndpoints.tei(args);
				case "transformersjs":
					return embeddingEndpoints.transformersjs(args);
				case "openai":
					return embeddingEndpoints.openai(args);
				case "hfapi":
					return embeddingEndpoints.hfapi(args);
				default:
					throw new Error(`Unknown endpoint type: ${args}`);
			}
		}

		random -= endpoint.weight;
	}

	throw new Error(`Failed to select embedding endpoint`);
};

export const getDefaultEmbeddingModel = async (): Promise<EmbeddingModel> => {
	if (!embeddingModels[0]) {
		throw new Error(`Failed to find default embedding endpoint`);
	}

	const defaultModel = await collections.embeddingModels.findOne({
		_id: embeddingModels[0]._id,
	});

	return defaultModel ? defaultModel : embeddingModels[0];
};

// to mimic current behaivor with creating embedding models from scratch during server start
export async function pupulateEmbeddingModel() {
	await collections.embeddingModels.deleteMany({});
	await collections.embeddingModels.insertMany(embeddingModels);
}
