import { HF_ACCESS_TOKEN, MODEL_ENDPOINTS } from "$env/static/private";
import { sum } from "$lib/utils/sum";
import { modelNames, models } from "./models";

const endpoints: Array<{ endpoint: string; authorization: string; weight: number }> =
	JSON.parse(MODEL_ENDPOINTS);
const totalWeight = sum(endpoints.map((e) => e.weight));

/**
 * Find a random load-balanced endpoint
 */
export function modelEndpoint(model: string): {
	endpoint: string;
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
			endpoint: `https://api-inference.huggingface.co/models/${modelDefinition}`,
			authorization: `Bearer ${HF_ACCESS_TOKEN}`,
			weight: 1,
		};
	}
	let random = Math.random() * totalWeight;
	for (const endpoint of endpoints) {
		if (random < endpoint.weight) {
			return endpoint;
		}
		random -= endpoint.weight;
	}

	throw new Error("Invalid config, no endpoint found");
}
