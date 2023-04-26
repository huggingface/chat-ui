import { MODEL_ENDPOINTS } from "$env/static/private";
import { sum } from "$lib/utils/sum";

const endpoints: Array<{ endpoint: string; authorization: string; weight: number }> =
	JSON.parse(MODEL_ENDPOINTS);
const totalWeight = sum(endpoints.map((e) => e.weight));

/**
 * Find a random load-balanced endpoint
 */
export function modelEndpoint(): { endpoint: string; authorization: string; weight: number } {
	let random = Math.random() * totalWeight;
	for (const endpoint of endpoints) {
		if (random < endpoint.weight) {
			return endpoint;
		}
		random -= endpoint.weight;
	}

	throw new Error("Invalid config, no endpoint found");
}
