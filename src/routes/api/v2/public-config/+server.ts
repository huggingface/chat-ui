import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { config } from "$lib/server/config";

// Public config is pure env-var data that changes only on server restart.
// Cache for 60s so back-to-back layout reloads skip the round-trip.
const PUBLIC_CONFIG_CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };

export const GET: RequestHandler = async () => {
	return superjsonResponse(await config.getPublicConfig(), {
		headers: PUBLIC_CONFIG_CACHE_HEADERS,
	});
};
