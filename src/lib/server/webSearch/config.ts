export interface SearchProviderConfig {
	name: string;
	enabled: boolean;
	priority: number;
	rateLimit?: {
		requestsPerMinute: number;
		requestsPerDay: number;
	};
	apiKey?: string;
	additionalConfig?: Record<string, any>;
}

export interface WebSearchConfig {
	providers: Record<string, SearchProviderConfig>;
	fallbackToMock: boolean;
	maxResults: number;
	timeout: number;
	cacheEnabled: boolean;
	cacheTTL: number; // in seconds
}

// Default configuration
export const defaultWebSearchConfig: WebSearchConfig = {
	providers: {
		google: {
			name: "Google Custom Search",
			enabled: true,
			priority: 1,
			rateLimit: {
				requestsPerMinute: 10,
				requestsPerDay: 100,
			},
			apiKey: process.env.GOOGLE_SEARCH_API_KEY,
			additionalConfig: {
				searchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
			},
		},
		exa: {
			name: "Exa MCP",
			enabled: true,
			priority: 2,
			rateLimit: {
				requestsPerMinute: 20,
				requestsPerDay: 1000,
			},
			apiKey: process.env.EXA_API_KEY,
			additionalConfig: {
				mcpEndpoint: process.env.EXA_MCP_ENDPOINT || "https://mcp.exa.ai/mcp",
			},
		},
		bing: {
			name: "Bing Search API",
			enabled: true,
			priority: 3,
			rateLimit: {
				requestsPerMinute: 15,
				requestsPerDay: 1000,
			},
			apiKey: process.env.BING_SEARCH_API_KEY,
		},
		serpapi: {
			name: "SerpAPI",
			enabled: true,
			priority: 4,
			rateLimit: {
				requestsPerMinute: 20,
				requestsPerDay: 100,
			},
			apiKey: process.env.SERPAPI_API_KEY,
		},
		duckduckgo: {
			name: "DuckDuckGo",
			enabled: true,
			priority: 5,
			rateLimit: {
				requestsPerMinute: 30,
				requestsPerDay: 1000,
			},
		},
		brave: {
			name: "Brave Search API",
			enabled: true,
			priority: 6,
			rateLimit: {
				requestsPerMinute: 20,
				requestsPerDay: 2000,
			},
			apiKey: process.env.BRAVE_SEARCH_API_KEY,
		},
	},
	fallbackToMock: true,
	maxResults: 10,
	timeout: 10000, // 10 seconds
	cacheEnabled: true,
	cacheTTL: 300, // 5 minutes
};

// Get enabled providers sorted by priority
export function getEnabledProviders(
	config: WebSearchConfig = defaultWebSearchConfig
): SearchProviderConfig[] {
	return Object.values(config.providers)
		.filter((provider) => provider.enabled && provider.apiKey)
		.sort((a, b) => a.priority - b.priority);
}

// Check if any provider is available
export function hasAvailableProviders(config: WebSearchConfig = defaultWebSearchConfig): boolean {
	return getEnabledProviders(config).length > 0;
}
