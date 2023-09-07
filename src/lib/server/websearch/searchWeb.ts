import { SERPAPI_KEY, SERPER_API_KEY } from "$env/static/private";

import { getJson } from "serpapi";
import type { GoogleParameters } from "serpapi";

// Show result as JSON
export async function searchWeb(query: string) {
	if (SERPER_API_KEY) {
		return await searchWebSerper(query);
	}
	if (SERPAPI_KEY) {
		return await searchWebSerpApi(query);
	}
	throw new Error("No Serper.dev or SerpAPI key found");
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
		knowledge_graph: data["knowledgeGraph"] ?? null,
		answer_box: data["answerBox"] ?? null,
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
