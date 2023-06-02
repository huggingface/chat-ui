import { SERPAPI_KEY } from "$env/static/private";

import { getJson } from "serpapi";
import type { GoogleParameters } from "serpapi";

// Show result as JSON
export async function searchWeb(query: string) {
	const params = {
		q: query,
		hl: "en",
		gl: "us",
		google_domain: "google.com",
		api_key: SERPAPI_KEY,
	} satisfies GoogleParameters;

	// Show result as JSON
	const response = await getJson("google", params);

	return response;
}
