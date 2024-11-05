import { env } from "$env/dynamic/private";
import { getJson, type GoogleParameters } from "serpapi";
import type { WebSearchSource } from "$lib/types/WebSearch";
import { isURL } from "$lib/server/isURLLocal";

export default async function searchWebSerpApi(query: string): Promise<WebSearchSource[]> {
	const params = {
		q: query,
		hl: "en",
		gl: "us",
		google_domain: "google.com",
		api_key: env.SERPAPI_KEY,
	} satisfies GoogleParameters;

	// Show result as JSON
	const response = await getJson("google", params);

	// todo: typing
	return response.organic_results.filter(({ link }) => isURL(link));
}
