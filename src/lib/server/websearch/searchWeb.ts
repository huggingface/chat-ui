import type { YouWebSearch } from "../../types/WebSearch";
import { WebSearchProvider } from "../../types/WebSearch";
import { SERPAPI_KEY, SERPER_API_KEY, YDC_API_KEY } from "$env/static/private";
import { getJson } from "serpapi";
import type { GoogleParameters } from "serpapi";

// get which SERP api is providing web results
export function getWebSearchProvider() {
	return YDC_API_KEY ? WebSearchProvider.YOU : WebSearchProvider.GOOGLE;
}

// Show result as JSON
export async function searchWeb(query: string) {
	if (SERPER_API_KEY) {
		return await searchWebSerper(query);
	}
	if (YDC_API_KEY) {
		return await searchWebYouApi(query);
	}
	if (SERPAPI_KEY) {
		return await searchWebSerpApi(query);
	}
	throw new Error("No You.com or Serper.dev or SerpAPI key found");
}

export async function searchWebSerper(query: string) {
	const params = {
		q: query,
		hl: "en",
		gl: "us",
	};

	const response = await fetch("https://google.serper.dev/search", {
		method: "POST",
		body: JSON.stringify(params),
		headers: {
			"x-api-key": SERPER_API_KEY,
			"Content-type": "application/json; charset=UTF-8",
		},
	});

	/* eslint-disable @typescript-eslint/no-explicit-any */
	const data = (await response.json()) as Record<string, any>;

	if (!response.ok) {
		throw new Error(
			data["message"] ??
				`Serper API returned error code ${response.status} - ${response.statusText}`
		);
	}

	return {
		organic_results: data["organic"] ?? [],
	};
}

export async function searchWebSerpApi(query: string) {
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

export async function searchWebYouApi(query: string) {
	const response = await fetch(`https://api.ydc-index.io/search?query=${query}`, {
		method: "GET",
		headers: {
			"X-API-Key": YDC_API_KEY,
			"Content-type": "application/json; charset=UTF-8",
		},
	});

	if (!response.ok) {
		throw new Error(`You.com API returned error code ${response.status} - ${response.statusText}`);
	}

	const data = (await response.json()) as YouWebSearch;
	const formattedResultsWithSnippets = data.hits
		.map(({ title, url, snippets }) => ({
			title,
			link: url,
			text: snippets?.join("\n") || "",
			hostname: new URL(url).hostname,
		}))
		.sort((a, b) => b.text.length - a.text.length); // desc order by text length

	return {
		organic_results: formattedResultsWithSnippets,
	};
}
