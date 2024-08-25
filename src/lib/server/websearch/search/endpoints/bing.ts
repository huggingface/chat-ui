import type { WebSearchSource } from "$lib/types/WebSearch";
import { env } from "$env/dynamic/private";

export default async function search(query: string): Promise<WebSearchSource[]> {
	// const params = {
	//     q: query,
	//     // You can add other parameters if needed, like 'count', 'offset', etc.
	// };

	const response = await fetch(
		"https://api.bing.microsoft.com/v7.0/search" + "?q=" + encodeURIComponent(query),
		{
			method: "GET",
			headers: {
				"Ocp-Apim-Subscription-Key": env.BING_SUBSCRIPTION_KEY,
				"Content-type": "application/json",
			},
		}
	);

	/* eslint-disable @typescript-eslint/no-explicit-any */
	const data = (await response.json()) as Record<string, any>;

	if (!response.ok) {
		throw new Error(
			data["message"] ?? `Bing API returned error code ${response.status} - ${response.statusText}`
		);
	}

	console.log(data["webPages"]?.["value"]);

	// Adapt the data structure from the Bing response to match the WebSearchSource type
	const webPages = data["webPages"]?.["value"] ?? [];
	return webPages.map((page: any) => ({
		title: page.name,
		link: page.url,
		text: page.snippet,
		displayLink: page.displayUrl,
	}));
}
