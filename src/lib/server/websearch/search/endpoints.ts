import { WebSearchProvider, type WebSearchSource } from "$lib/types/WebSearch";
import { env } from "$env/dynamic/private";
import searchSerper from "./endpoints/serper";
import searchSerpApi from "./endpoints/serpApi";
import searchSerpStack from "./endpoints/serpStack";
import searchYouApi from "./endpoints/youApi";
import searchWebLocal from "./endpoints/webLocal";
import searchSearxng from "./endpoints/searxng";
import searchSearchApi from "./endpoints/searchApi";
import searchBing from "./endpoints/bing";

export function getWebSearchProvider() {
	if (env.YDC_API_KEY) return WebSearchProvider.YOU;
	if (env.SEARXNG_QUERY_URL) return WebSearchProvider.SEARXNG;
	if (env.BING_SUBSCRIPTION_KEY) return WebSearchProvider.BING;
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
	if (env.SEARCHAPI_KEY) return searchSearchApi(query);
	if (env.BING_SUBSCRIPTION_KEY) return searchBing(query);
	throw new Error(
		"No configuration found for web search. Please set USE_LOCAL_WEBSEARCH, SEARXNG_QUERY_URL, SERPER_API_KEY, YDC_API_KEY, SERPSTACK_API_KEY, or SEARCHAPI_KEY in your environment variables."
	);
}
