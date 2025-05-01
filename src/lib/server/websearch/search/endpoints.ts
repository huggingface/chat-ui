import { WebSearchProvider, type WebSearchSource } from "$lib/types/WebSearch";
import { config } from "$lib/server/config";
import searchSerper from "./endpoints/serper";
import searchSerpApi from "./endpoints/serpApi";
import searchSerpStack from "./endpoints/serpStack";
import searchYouApi from "./endpoints/youApi";
import searchWebLocal from "./endpoints/webLocal";
import searchSearxng from "./endpoints/searxng";
import searchSearchApi from "./endpoints/searchApi";
import searchBing from "./endpoints/bing";

const providerMap: Record<WebSearchProvider, (q: string) => Promise<WebSearchSource[]>> = {
	[WebSearchProvider.GOOGLE]: searchSerper,
	[WebSearchProvider.SERPER]: searchSerper,
	[WebSearchProvider.BING]: searchBing,
	[WebSearchProvider.DUCKDUCKGO]: searchSearxng,
	[WebSearchProvider.YOU]: searchYouApi,
	[WebSearchProvider.SEARXNG]: searchSearxng,
	[WebSearchProvider.SERPAPI]: searchSerpApi,
	[WebSearchProvider.SERPSTACK]: searchSerpStack,
	[WebSearchProvider.SEARCHAPI]: searchSearchApi,
	[WebSearchProvider.LOCAL]: searchWebLocal,
};

export function getWebSearchProvider() {
	if (config.YDC_API_KEY) return WebSearchProvider.YOU;
	if (config.SEARXNG_QUERY_URL) return WebSearchProvider.SEARXNG;
	if (config.BING_SUBSCRIPTION_KEY) return WebSearchProvider.BING;
	return WebSearchProvider.GOOGLE;
}

/** Searches the web using the first available provider, based on the env */
export async function searchWeb(
	query: string,
	provider?: WebSearchProvider
): Promise<WebSearchSource[]> {
	if (provider) {
		const fn = providerMap[provider];
		if (!fn) throw new Error(`Provider ${provider} not found`);
		return fn(query);
	}
	if (config.USE_LOCAL_WEBSEARCH) return searchWebLocal(query);
	if (config.SEARXNG_QUERY_URL) return searchSearxng(query);
	if (config.SERPER_API_KEY) return searchSerper(query);
	if (config.YDC_API_KEY) return searchYouApi(query);
	if (config.SERPAPI_KEY) return searchSerpApi(query);
	if (config.SERPSTACK_API_KEY) return searchSerpStack(query);
	if (config.SEARCHAPI_KEY) return searchSearchApi(query);
	if (config.BING_SUBSCRIPTION_KEY) return searchBing(query);
	throw new Error(
		"No configuration found for web search. Please set USE_LOCAL_WEBSEARCH, SEARXNG_QUERY_URL, SERPER_API_KEY, YDC_API_KEY, SERPSTACK_API_KEY, or SEARCHAPI_KEY in your environment variables."
	);
}
