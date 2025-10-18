export interface SearchAnalytics {
	totalSearches: number;
	successfulSearches: number;
	failedSearches: number;
	providerUsage: Record<string, number>;
	queryTypes: Record<string, number>;
	averageResponseTime: number;
	lastSearch: Date | null;
	rateLimitHits: Record<string, number>;
}

export interface SearchEvent {
	timestamp: Date;
	query: string;
	provider: string;
	success: boolean;
	responseTime: number;
	resultCount: number;
	error?: string;
}

// In-memory analytics storage (in production, use a database)
const analytics: SearchAnalytics = {
	totalSearches: 0,
	successfulSearches: 0,
	failedSearches: 0,
	providerUsage: {},
	queryTypes: {},
	averageResponseTime: 0,
	lastSearch: null,
	rateLimitHits: {}
};

const searchEvents: SearchEvent[] = [];

/**
 * Record a search event
 */
export function recordSearchEvent(event: Omit<SearchEvent, 'timestamp'>): void {
	const searchEvent: SearchEvent = {
		...event,
		timestamp: new Date()
	};
	
	searchEvents.push(searchEvent);
	
	// Update analytics
	analytics.totalSearches++;
	if (event.success) {
		analytics.successfulSearches++;
	} else {
		analytics.failedSearches++;
	}
	
	// Update provider usage
	analytics.providerUsage[event.provider] = (analytics.providerUsage[event.provider] || 0) + 1;
	
	// Update query types (simple categorization)
	const queryType = categorizeQuery(event.query);
	analytics.queryTypes[queryType] = (analytics.queryTypes[queryType] || 0) + 1;
	
	// Update average response time
	const totalTime = analytics.averageResponseTime * (analytics.totalSearches - 1) + event.responseTime;
	analytics.averageResponseTime = totalTime / analytics.totalSearches;
	
	analytics.lastSearch = searchEvent.timestamp;
	
	// Keep only last 1000 events to prevent memory issues
	if (searchEvents.length > 1000) {
		searchEvents.splice(0, searchEvents.length - 1000);
	}
}

/**
 * Record a rate limit hit
 */
export function recordRateLimitHit(provider: string): void {
	analytics.rateLimitHits[provider] = (analytics.rateLimitHits[provider] || 0) + 1;
}

/**
 * Get current analytics
 */
export function getAnalytics(): SearchAnalytics {
	return { ...analytics };
}

/**
 * Get search events (with optional filtering)
 */
export function getSearchEvents(limit?: number): SearchEvent[] {
	const events = [...searchEvents].reverse(); // Most recent first
	return limit ? events.slice(0, limit) : events;
}

/**
 * Get analytics for a specific time period
 */
export function getAnalyticsForPeriod(hours: number): Partial<SearchAnalytics> {
	const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
	const recentEvents = searchEvents.filter(event => event.timestamp >= cutoff);
	
	if (recentEvents.length === 0) {
		return {
			totalSearches: 0,
			successfulSearches: 0,
			failedSearches: 0,
			providerUsage: {},
			queryTypes: {},
			averageResponseTime: 0
		};
	}
	
	const successful = recentEvents.filter(e => e.success).length;
	const failed = recentEvents.length - successful;
	
	const providerUsage: Record<string, number> = {};
	const queryTypes: Record<string, number> = {};
	
	recentEvents.forEach(event => {
		providerUsage[event.provider] = (providerUsage[event.provider] || 0) + 1;
		const queryType = categorizeQuery(event.query);
		queryTypes[queryType] = (queryTypes[queryType] || 0) + 1;
	});
	
	const avgResponseTime = recentEvents.reduce((sum, e) => sum + e.responseTime, 0) / recentEvents.length;
	
	return {
		totalSearches: recentEvents.length,
		successfulSearches: successful,
		failedSearches: failed,
		providerUsage,
		queryTypes,
		averageResponseTime: avgResponseTime
	};
}

/**
 * Categorize a query for analytics
 */
function categorizeQuery(query: string): string {
	const lowerQuery = query.toLowerCase();
	
	if (lowerQuery.includes('who is') || lowerQuery.includes('who was')) {
		return 'person';
	} else if (lowerQuery.includes('what is') || lowerQuery.includes('what are')) {
		return 'definition';
	} else if (lowerQuery.includes('how to') || lowerQuery.includes('how do')) {
		return 'tutorial';
	} else if (lowerQuery.includes('latest') || lowerQuery.includes('recent') || lowerQuery.includes('news')) {
		return 'news';
	} else if (lowerQuery.includes('weather') || lowerQuery.includes('temperature')) {
		return 'weather';
	} else if (lowerQuery.includes('price') || lowerQuery.includes('cost') || lowerQuery.includes('buy')) {
		return 'shopping';
	} else {
		return 'general';
	}
}

/**
 * Get provider performance metrics
 */
export function getProviderPerformance(): Record<string, {
	successRate: number;
	averageResponseTime: number;
	totalSearches: number;
	lastUsed: Date | null;
}> {
	const providerStats: Record<string, {
		successRate: number;
		averageResponseTime: number;
		totalSearches: number;
		lastUsed: Date | null;
	}> = {};
	
	Object.keys(analytics.providerUsage).forEach(provider => {
		const providerEvents = searchEvents.filter(e => e.provider === provider);
		const successful = providerEvents.filter(e => e.success).length;
		const total = providerEvents.length;
		const avgTime = providerEvents.reduce((sum, e) => sum + e.responseTime, 0) / total;
		const lastUsed = providerEvents.length > 0 ? providerEvents[providerEvents.length - 1].timestamp : null;
		
		providerStats[provider] = {
			successRate: total > 0 ? (successful / total) * 100 : 0,
			averageResponseTime: avgTime,
			totalSearches: total,
			lastUsed
		};
	});
	
	return providerStats;
}

/**
 * Reset analytics (useful for testing)
 */
export function resetAnalytics(): void {
	analytics.totalSearches = 0;
	analytics.successfulSearches = 0;
	analytics.failedSearches = 0;
	analytics.providerUsage = {};
	analytics.queryTypes = {};
	analytics.averageResponseTime = 0;
	analytics.lastSearch = null;
	analytics.rateLimitHits = {};
	searchEvents.length = 0;
}

/**
 * Export analytics to JSON
 */
export function exportAnalytics(): string {
	return JSON.stringify({
		analytics,
		events: searchEvents,
		exportedAt: new Date().toISOString()
	}, null, 2);
}

