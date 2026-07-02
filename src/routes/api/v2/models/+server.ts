import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { serializeModelSummary } from "$lib/server/api/utils/serializeModel";
import type { GETModelsResponse } from "$lib/server/api/types";

// Models are loaded once at server startup; new models appear on redeploy.
// Cache for 60s so repeated invalidations (e.g. from settings saves) don't
// generate a round-trip.
const MODELS_CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };

export const GET: RequestHandler = async () => {
	try {
		const { models } = await import("$lib/server/models");
		return superjsonResponse(
			models
				.filter((m) => m.unlisted == false)
				.map(serializeModelSummary) satisfies GETModelsResponse,
			{ headers: MODELS_CACHE_HEADERS }
		);
	} catch {
		return superjsonResponse([] as GETModelsResponse);
	}
};
