import { WebSearchProvider, type WebSearchSource } from "$lib/types/WebSearch";
import { env } from "$env/dynamic/private";
import searchSerper from "./endpoints/serper";
import searchSerpApi from "./endpoints/serpApi";
import searchSerpStack from "./endpoints/serpStack";
import searchYouApi from "./endpoints/youApi";
import searchWebLocal from "./endpoints/webLocal";
import searchSearxng from "./endpoints/searxng";

export function getWebSearchProvider() {
	if (env.YDC_API_KEY) return WebSearchProvider.YOU;
	if (env.SEARXNG_QUERY_URL) return WebSearchProvider.SEARXNG;
	return WebSearchProvider.GOOGLE;
}

/** Searches the web using the first available provider, based on the env */
export async function searchWeb(query: string): Promise<WebSearchSource[]> {
	if (env.USE_LOCAL_WEBSEARCH) return searchWebLocal(query);
	if (env.SEARXNG_QUERY_URL) return searchSearxng(query);
	if (env.SERPER_API_KEY) return searchSerper(query);
	if (env.YDC_API_KEY) return searchYouApi(query);
	if (env.SERPAPI_KEY) return searchSerpApi(query);
	if (env.SERPSTACK_API_KEY) return searchSerpStack(query);
	throw new Error(
		"No configuration found for web search. Please set USE_LOCAL_WEBSEARCH, SEARXNG_QUERY_URL, SERPER_API_KEY, YDC_API_KEY, or SERPSTACK_API_KEY in your environment variables."
	);
}
