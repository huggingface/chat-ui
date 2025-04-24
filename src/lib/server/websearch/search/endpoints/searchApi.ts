import { config } from "$lib/server/config";
import type { WebSearchSource } from "$lib/types/WebSearch";

export default async function search(query: string): Promise<WebSearchSource[]> {
	const response = await fetch(
		`https://www.searchapi.io/api/v1/search?engine=google&hl=en&gl=us&q=${query}`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${config.SEARCHAPI_KEY}`,
				"Content-type": "application/json",
			},
		}
	);

	/* eslint-disable @typescript-eslint/no-explicit-any */
	const data = (await response.json()) as Record<string, any>;

	if (!response.ok) {
		throw new Error(
			data["message"] ?? `SearchApi returned error code ${response.status} - ${response.statusText}`
		);
	}

	return data["organic_results"] ?? [];
}
