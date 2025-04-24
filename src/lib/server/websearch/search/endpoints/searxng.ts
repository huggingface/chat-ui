import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { WebSearchSource } from "$lib/types/WebSearch";
import { isURL } from "$lib/utils/isUrl";

export default async function searchSearxng(query: string): Promise<WebSearchSource[]> {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);

	// Insert the query into the URL template
	let url = config.SEARXNG_QUERY_URL.replace("<query>", query);

	// Check if "&format=json" already exists in the URL
	if (!url.includes("&format=json")) {
		url += "&format=json";
	}

	// Call the URL to return JSON data
	const jsonResponse = await fetch(url, {
		signal: abortController.signal,
	})
		.then((response) => response.json() as Promise<{ results: { url: string }[] }>)
		.catch((error) => {
			logger.error(error, "Failed to fetch or parse JSON");
			throw new Error("Failed to fetch or parse JSON", { cause: error });
		});

	// Extract 'url' elements from the JSON response and trim to the top 5 URLs
	const urls = jsonResponse.results.slice(0, 5).map((item) => item.url);

	if (!urls.length) {
		throw new Error(`Response doesn't contain any "url" elements`);
	}

	// Map URLs to the correct object shape
	return urls.filter(isURL).map((link) => ({ link }));
}
