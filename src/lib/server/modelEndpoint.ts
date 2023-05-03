import { HF_ACCESS_TOKEN } from "$env/static/private";
import { sum } from "$lib/utils/sum";
import { models } from "./models";

/**
 * Find a random load-balanced endpoint
 */
export function modelEndpoint(model: string): {
	url: string;
	authorization: string;
	weight: number;
} {
	const modelDefinition = models.find(
		(m) => m === model || (typeof m === "object" && m.name === model)
	);
	if (!modelDefinition) {
		throw new Error(`Invalid model: ${model}`);
	}
	if (typeof modelDefinition === "string") {
		return {
			url: `https://api-inference.huggingface.co/models/${modelDefinition}`,
			authorization: `Bearer ${HF_ACCESS_TOKEN}`,
			weight: 1,
		};
	}
	if (!modelDefinition.endpoints) {
		return {
			url: `https://api-inference.huggingface.co/models/${modelDefinition.name}`,
			authorization: `Bearer ${HF_ACCESS_TOKEN}`,
			weight: 1,
		};
	}
	const endpoints = modelDefinition.endpoints;
	const totalWeight = sum(endpoints.map((e) => e.weight));

	let random = Math.random() * totalWeight;
	for (const endpoint of endpoints) {
		if (random < endpoint.weight) {
			return endpoint;
		}
		random -= endpoint.weight;
	}

	throw new Error("Invalid config, no endpoint found");
}
