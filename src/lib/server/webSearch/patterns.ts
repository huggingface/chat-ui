export interface SearchPattern {
	pattern: RegExp;
	extractQuery: (match: RegExpMatchArray, content: string) => string;
	priority: number;
	description: string;
}

/**
 * Customizable web search detection patterns
 * Add, modify, or remove patterns as needed
 */
export const searchPatterns: SearchPattern[] = [
	{
		pattern: /🌐.*using web search\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 1,
		description: "Globe emoji with 'using web search'"
	},
	{
		pattern: /web search\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 2,
		description: "Simple 'web search' prefix"
	},
	{
		pattern: /search the web\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 3,
		description: "Search the web prefix"
	},
	{
		pattern: /find information about\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 4,
		description: "Find information about prefix"
	},
	{
		pattern: /latest information about\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 5,
		description: "Latest information about prefix"
	},
	{
		pattern: /current news about\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 6,
		description: "Current news about prefix"
	},
	{
		pattern: /look up\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 7,
		description: "Look up prefix"
	},
	{
		pattern: /search for\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 8,
		description: "Search for prefix"
	},
	{
		pattern: /what is\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 9,
		description: "What is question"
	},
	{
		pattern: /who is\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 10,
		description: "Who is question"
	},
	{
		pattern: /tell me about\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 11,
		description: "Tell me about prefix"
	},
	{
		pattern: /explain\s+(.+)/i,
		extractQuery: (match) => match[1].trim(),
		priority: 12,
		description: "Explain prefix"
	}
];

/**
 * Enhanced web search detection with customizable patterns
 */
export function detectWebSearchRequest(content: string): string | null {
	// Sort patterns by priority (lower number = higher priority)
	const sortedPatterns = [...searchPatterns].sort((a, b) => a.priority - b.priority);
	
	for (const { pattern, extractQuery } of sortedPatterns) {
		const match = content.match(pattern);
		if (match) {
			const query = extractQuery(match, content);
			if (query && query.length > 0) {
				return query;
			}
		}
	}
	
	return null;
}

/**
 * Add a custom search pattern
 */
export function addSearchPattern(pattern: SearchPattern): void {
	searchPatterns.push(pattern);
	// Re-sort by priority
	searchPatterns.sort((a, b) => a.priority - b.priority);
}

/**
 * Remove a search pattern by description
 */
export function removeSearchPattern(description: string): boolean {
	const index = searchPatterns.findIndex(p => p.description === description);
	if (index !== -1) {
		searchPatterns.splice(index, 1);
		return true;
	}
	return false;
}

/**
 * Get all available patterns
 */
export function getSearchPatterns(): SearchPattern[] {
	return [...searchPatterns];
}

/**
 * Test patterns against sample messages
 */
export function testPatterns(sampleMessages: string[]): void {
	console.log("🧪 Testing Search Patterns");
	console.log("==========================");
	
	sampleMessages.forEach((message, index) => {
		const query = detectWebSearchRequest(message);
		console.log(`${index + 1}. "${message}"`);
		console.log(`   → ${query ? `✅ Detected: "${query}"` : "❌ No search detected"}`);
	});
}

