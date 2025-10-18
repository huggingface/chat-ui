import { 
	searchWithGoogle, 
	searchWithBing, 
	searchWithSerpAPI, 
	searchWithDuckDuckGo, 
	searchWithBrave, 
	searchWithYouCom 
} from "./searchProviders";
import { defaultWebSearchConfig, getEnabledProviders, hasAvailableProviders } from "./config";
import { detectWebSearchRequest as detectWithPatterns } from "./patterns";
import { recordSearchEvent, recordRateLimitHit } from "./analytics";

export interface WebSearchResult {
	title: string;
	link: string;
	snippet: string;
}

export interface WebSearchResponse {
	results: WebSearchResult[];
	query: string;
}

/**
 * Performs web search using multiple search APIs with intelligent fallback
 * Supports: Google, Bing, SerpAPI, DuckDuckGo, Brave, You.com
 */
export async function performWebSearch(query: string, config = defaultWebSearchConfig): Promise<WebSearchResponse> {
	console.log(`Performing web search for: ${query}`);
	
	// Check if any providers are available
	if (!hasAvailableProviders(config)) {
		console.warn("No search providers configured, using mock data");
		return getMockSearchResults(query);
	}

	// Get enabled providers in priority order
	const enabledProviders = getEnabledProviders(config);
	
	// Map provider names to their functions
	const providerFunctions = {
		google: searchWithGoogle,
		bing: searchWithBing,
		serpapi: searchWithSerpAPI,
		duckduckgo: searchWithDuckDuckGo,
		brave: searchWithBrave,
		youcom: searchWithYouCom
	};

	// Try each provider in order of priority
	for (const provider of enabledProviders) {
		const startTime = Date.now();
		try {
			const providerKey = provider.name.toLowerCase().replace(/\s+/g, '');
			const searchFunction = providerFunctions[providerKey as keyof typeof providerFunctions];
			
			if (!searchFunction) {
				console.warn(`No function found for provider: ${provider.name}`);
				continue;
			}

			console.log(`Trying ${provider.name} search...`);
			const result = await searchFunction(query, provider);
			const responseTime = Date.now() - startTime;
			
			// Record successful search
			recordSearchEvent({
				query,
				provider: provider.name,
				success: true,
				responseTime,
				resultCount: result.results.length
			});
			
			console.log(`Found ${result.results.length} results with ${provider.name} in ${responseTime}ms`);
			return result;
		} catch (error) {
			const responseTime = Date.now() - startTime;
			const errorMessage = error instanceof Error ? error.message : String(error);
			
			// Check if it's a rate limit error
			if (errorMessage.includes('rate limit')) {
				recordRateLimitHit(provider.name);
			}
			
			// Record failed search
			recordSearchEvent({
				query,
				provider: provider.name,
				success: false,
				responseTime,
				resultCount: 0,
				error: errorMessage
			});
			
			console.warn(`${provider.name} search failed:`, error);
			// Continue to next provider
		}
	}

	// If all providers fail, return mock data
	console.warn("All search providers failed, returning mock data");
	return getMockSearchResults(query);
}

/**
 * Returns mock search results for development/testing
 */
function getMockSearchResults(query: string): WebSearchResponse {
	const mockResults: WebSearchResult[] = [
		{
			title: `Search Result 1 for "${query}"`,
			link: "https://example.com/result1",
			snippet: `This is a sample search result snippet for "${query}". It demonstrates how web search results would appear in the chat interface.`
		},
		{
			title: `Search Result 2 for "${query}"`, 
			link: "https://example.com/result2",
			snippet: `Another sample search result snippet for "${query}". This shows how multiple results are handled.`
		},
		{
			title: `Search Result 3 for "${query}"`,
			link: "https://example.com/result3", 
			snippet: `A third sample result for "${query}". This demonstrates the citation system with numbered references.`
		}
	];

	return {
		results: mockResults,
		query
	};
}

/**
 * Detects if a message contains web search requests using enhanced patterns
 */
export function detectWebSearchRequest(content: string): string | null {
	return detectWithPatterns(content);
}
