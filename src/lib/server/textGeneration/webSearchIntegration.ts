import { detectWebSearchRequest, performWebSearch } from "$lib/server/webSearch/webSearchService";
import { MessageUpdateType, type MessageUpdate } from "$lib/types/MessageUpdate";
import type { EndpointMessage } from "$lib/server/endpoints/endpoints";

/**
 * Integrates web search functionality into the text generation pipeline
 */
export async function* handleWebSearch(
	messages: EndpointMessage[],
	update: (event: MessageUpdate) => Promise<void>
): AsyncGenerator<{ sources: { title?: string; link: string }[] } | null, void, unknown> {
	// Check if the last message contains a web search request
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage || lastMessage.role !== 'user') {
		yield null;
		return;
	}

	const searchQuery = detectWebSearchRequest(lastMessage.content);
	if (!searchQuery) {
		yield null;
		return;
	}

	try {
		// Send web search status update
		await update({
			type: MessageUpdateType.WebSearch,
			status: "searching",
			query: searchQuery,
			message: "Searching the web..."
		});

		// Perform the web search
		const searchResponse = await performWebSearch(searchQuery);
		
		// Convert search results to sources format
		const sources = searchResponse.results.map(result => ({
			title: result.title,
			link: result.link
		}));

		// Send sources update
		await update({
			type: MessageUpdateType.WebSearchSources,
			sources
		});

		// Send completion status
		await update({
			type: MessageUpdateType.WebSearch,
			status: "completed",
			query: searchQuery,
			message: `Found ${sources.length} search results`
		});

		yield { sources };
	} catch (error) {
		console.error("Web search error:", error);
		
		// Send error status
		await update({
			type: MessageUpdateType.WebSearch,
			status: "error",
			query: searchQuery,
			message: "Web search failed"
		});

		yield null;
	}
}

/**
 * Enhances the user's message with web search context
 */
export function enhanceMessageWithWebSearch(
	originalMessage: string,
	searchResults: { title?: string; link: string }[]
): string {
	if (searchResults.length === 0) {
		return originalMessage;
	}

	// Add web search context to the message
	const searchContext = `\n\nWeb search results:\n${searchResults
		.map((result, index) => `[${index + 1}] ${result.title}: ${result.link}`)
		.join('\n')}`;

	return originalMessage + searchContext;
}

