import { SEARXNG_QUERY_URL } from "$env/static/private";

export async function searchSearxng(query: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);

	// Insert the query into the URL template
	let url = SEARXNG_QUERY_URL.replace("<query>", query);

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
			console.error("Failed to fetch or parse JSON", error);
			throw new Error("Failed to fetch or parse JSON");
		});

	// Extract 'url' elements from the JSON response and trim to the top 5 URLs
	const urls = jsonResponse.results.slice(0, 5).map((item) => item.url);

	if (!urls.length) {
		throw new Error(`Response doesn't contain any "url" elements`);
	}

	// Map URLs to the correct object shape
	return { organic_results: urls.map((link) => ({ link })) };
}
