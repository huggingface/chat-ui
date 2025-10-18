import type { WebSearchResult, WebSearchResponse } from "./webSearchService";
import { defaultWebSearchConfig, type SearchProviderConfig } from "./config";

// Rate limiting storage
const rateLimitStore = new Map<string, { requests: number[]; dailyRequests: number; lastReset: Date }>();

/**
 * Check rate limits for a provider
 */
function checkRateLimit(provider: SearchProviderConfig): boolean {
	const now = new Date();
	const key = provider.name.toLowerCase();
	const store = rateLimitStore.get(key) || { requests: [], dailyRequests: 0, lastReset: now };
	
	// Reset daily counter if it's a new day
	if (now.getDate() !== store.lastReset.getDate()) {
		store.dailyRequests = 0;
		store.lastReset = now;
	}
	
	// Check daily limit
	if (store.dailyRequests >= (provider.rateLimit?.requestsPerDay || Infinity)) {
		return false;
	}
	
	// Check per-minute limit
	const oneMinuteAgo = new Date(now.getTime() - 60000);
	store.requests = store.requests.filter(time => time > oneMinuteAgo.getTime());
	
	if (store.requests.length >= (provider.rateLimit?.requestsPerMinute || Infinity)) {
		return false;
	}
	
	// Record this request
	store.requests.push(now.getTime());
	store.dailyRequests++;
	rateLimitStore.set(key, store);
	
	return true;
}

/**
 * Google Custom Search API implementation
 * Requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables
 */
export async function searchWithGoogle(query: string, config?: SearchProviderConfig): Promise<WebSearchResponse> {
	const apiKey = config?.apiKey || process.env.GOOGLE_SEARCH_API_KEY;
	const searchEngineId = config?.additionalConfig?.searchEngineId || process.env.GOOGLE_SEARCH_ENGINE_ID;
	
	if (!apiKey || !searchEngineId) {
		throw new Error("Google Search API credentials not configured");
	}

	// Check rate limits
	if (config && !checkRateLimit(config)) {
		throw new Error("Google Search API rate limit exceeded");
	}

	const url = new URL("https://www.googleapis.com/customsearch/v1");
	url.searchParams.set("key", apiKey);
	url.searchParams.set("cx", searchEngineId);
	url.searchParams.set("q", query);
	url.searchParams.set("num", "10"); // Limit to 10 results

	const response = await fetch(url.toString());
	
	if (!response.ok) {
		throw new Error(`Google Search API error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = (data.items || []).map((item: any) => ({
		title: item.title,
		link: item.link,
		snippet: item.snippet || ""
	}));

	return {
		results,
		query
	};
}

/**
 * Bing Search API implementation
 * Requires BING_SEARCH_API_KEY environment variable
 */
export async function searchWithBing(query: string): Promise<WebSearchResponse> {
	const apiKey = process.env.BING_SEARCH_API_KEY;
	
	if (!apiKey) {
		throw new Error("Bing Search API key not configured");
	}

	const url = new URL("https://api.bing.microsoft.com/v7.0/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", "10");

	const response = await fetch(url.toString(), {
		headers: {
			"Ocp-Apim-Subscription-Key": apiKey
		}
	});
	
	if (!response.ok) {
		throw new Error(`Bing Search API error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = (data.webPages?.value || []).map((item: any) => ({
		title: item.name,
		link: item.url,
		snippet: item.snippet || ""
	}));

	return {
		results,
		query
	};
}

/**
 * SerpAPI implementation
 * Requires SERPAPI_API_KEY environment variable
 */
export async function searchWithSerpAPI(query: string): Promise<WebSearchResponse> {
	const apiKey = process.env.SERPAPI_API_KEY;
	
	if (!apiKey) {
		throw new Error("SerpAPI key not configured");
	}

	const url = new URL("https://serpapi.com/search");
	url.searchParams.set("api_key", apiKey);
	url.searchParams.set("q", query);
	url.searchParams.set("engine", "google");
	url.searchParams.set("num", "10");

	const response = await fetch(url.toString());
	
	if (!response.ok) {
		throw new Error(`SerpAPI error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = (data.organic_results || []).map((item: any) => ({
		title: item.title,
		link: item.link,
		snippet: item.snippet || ""
	}));

	return {
		results,
		query
	};
}

/**
 * DuckDuckGo Search API implementation (Free, no API key required)
 */
export async function searchWithDuckDuckGo(query: string, config?: SearchProviderConfig): Promise<WebSearchResponse> {
	// Check rate limits
	if (config && !checkRateLimit(config)) {
		throw new Error("DuckDuckGo Search API rate limit exceeded");
	}

	const url = new URL("https://api.duckduckgo.com/");
	url.searchParams.set("q", query);
	url.searchParams.set("format", "json");
	url.searchParams.set("no_html", "1");
	url.searchParams.set("skip_disambig", "1");

	const response = await fetch(url.toString(), {
		headers: {
			"User-Agent": "ChatUI-WebSearch/1.0"
		}
	});
	
	if (!response.ok) {
		throw new Error(`DuckDuckGo Search API error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = [];
	
	// Add instant answer if available
	if (data.AbstractText) {
		results.push({
			title: data.Heading || "Instant Answer",
			link: data.AbstractURL || "",
			snippet: data.AbstractText
		});
	}
	
	// Add related topics
	if (data.RelatedTopics) {
		data.RelatedTopics.slice(0, 5).forEach((topic: any) => {
			if (topic.Text && topic.FirstURL) {
				results.push({
					title: topic.Text.split(' - ')[0] || topic.Text,
					link: topic.FirstURL,
					snippet: topic.Text
				});
			}
		});
	}

	return {
		results: results.slice(0, 10),
		query
	};
}

/**
 * Brave Search API implementation
 * Requires BRAVE_SEARCH_API_KEY environment variable
 */
export async function searchWithBrave(query: string, config?: SearchProviderConfig): Promise<WebSearchResponse> {
	const apiKey = config?.apiKey || process.env.BRAVE_SEARCH_API_KEY;
	
	if (!apiKey) {
		throw new Error("Brave Search API key not configured");
	}

	// Check rate limits
	if (config && !checkRateLimit(config)) {
		throw new Error("Brave Search API rate limit exceeded");
	}

	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", "10");

	const response = await fetch(url.toString(), {
		headers: {
			"X-Subscription-Token": apiKey,
			"Accept": "application/json"
		}
	});
	
	if (!response.ok) {
		throw new Error(`Brave Search API error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = (data.web?.results || []).map((item: any) => ({
		title: item.title,
		link: item.url,
		snippet: item.description || ""
	}));

	return {
		results,
		query
	};
}

/**
 * You.com Search API implementation
 * Requires YOUCOM_API_KEY environment variable
 */
export async function searchWithYouCom(query: string, config?: SearchProviderConfig): Promise<WebSearchResponse> {
	const apiKey = config?.apiKey || process.env.YOUCOM_API_KEY;
	
	if (!apiKey) {
		throw new Error("You.com API key not configured");
	}

	// Check rate limits
	if (config && !checkRateLimit(config)) {
		throw new Error("You.com API rate limit exceeded");
	}

	const url = new URL("https://api.ydc-index.io/search");
	url.searchParams.set("query", query);
	url.searchParams.set("num_web_results", "10");

	const response = await fetch(url.toString(), {
		headers: {
			"X-API-Key": apiKey,
			"Accept": "application/json"
		}
	});
	
	if (!response.ok) {
		throw new Error(`You.com API error: ${response.status}`);
	}

	const data = await response.json();
	
	const results: WebSearchResult[] = (data.hits || []).map((item: any) => ({
		title: item.title,
		link: item.url,
		snippet: item.snippet || ""
	}));

	return {
		results,
		query
	};
}
