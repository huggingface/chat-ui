import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import type { RequestHandler } from "@sveltejs/kit";
import pkg from "natural";
const { PorterStemmer } = pkg;

export type GETSearchEndpointReturn = Array<{
	id: string;
	title: string;
	content: string;
	matchedText: string;
	updatedAt: Date;
	model: string;
	assistantId?: string;
	mdoelTools?: boolean;
}>;

export const GET: RequestHandler = async ({ locals, url }) => {
	const searchQuery = url.searchParams.get("q");
	const p = parseInt(url.searchParams.get("p") ?? "0");

	if (!searchQuery || searchQuery.length < 3) {
		return Response.json([]);
	}

	if (locals.user?._id || locals.sessionId) {
		const convs = await collections.conversations
			.find({
				sessionId: undefined,
				...authCondition(locals),
				$text: { $search: searchQuery },
			})
			.sort({
				updatedAt: -1, // Sort by date updated in descending order
			})
			.project({
				title: 1,
				updatedAt: 1,
				model: 1,
				assistantId: 1,
				messages: 1,
				userId: 1,
			})
			.skip(p * 5)
			.limit(5)
			.toArray()
			.then((convs) =>
				convs.map((conv) => {
					let matchedContent = "";
					let matchedText = "";

					// Find the best match using stemming to handle MongoDB's text search behavior
					let bestMatch = null;
					let bestMatchLength = 0;

					// Simple function to find the best match in content
					const findBestMatch = (
						content: string,
						query: string
					): { start: number; end: number; text: string } | null => {
						const contentLower = content.toLowerCase();
						const queryLower = query.toLowerCase();

						// Try exact word boundary match first
						const wordRegex = new RegExp(
							`\\b${queryLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
							"gi"
						);
						const wordMatch = wordRegex.exec(content);
						if (wordMatch) {
							return {
								start: wordMatch.index,
								end: wordMatch.index + wordMatch[0].length - 1,
								text: wordMatch[0],
							};
						}

						// Try simple substring match
						const index = contentLower.indexOf(queryLower);
						if (index !== -1) {
							return {
								start: index,
								end: index + queryLower.length - 1,
								text: content.substring(index, index + queryLower.length),
							};
						}

						return null;
					};

					// Create search variations
					const searchVariations = [searchQuery.toLowerCase()];

					// Add stemmed variations
					try {
						const stemmed = PorterStemmer.stem(searchQuery.toLowerCase());
						if (stemmed !== searchQuery.toLowerCase()) {
							searchVariations.push(stemmed);
						}

						// Find actual words in conversations that stem to the same root
						for (const message of conv.messages) {
							if (message.content) {
								const words = message.content.toLowerCase().match(/\b\w+\b/g) || [];
								words.forEach((word: string) => {
									if (PorterStemmer.stem(word) === stemmed && !searchVariations.includes(word)) {
										searchVariations.push(word);
									}
								});
							}
						}
					} catch (e) {
						console.warn("Stemming failed for:", searchQuery, e);
					}

					// Add simple variations
					const query = searchQuery.toLowerCase();
					if (query.endsWith("s") && query.length > 3) {
						searchVariations.push(query.slice(0, -1));
					} else if (!query.endsWith("s")) {
						searchVariations.push(query + "s");
					}

					// Search through all messages for the best match
					for (const message of conv.messages) {
						if (!message.content) continue;

						// Try each variation in order of preference
						for (const variation of searchVariations) {
							const match = findBestMatch(message.content, variation);
							if (match) {
								const isExactQuery = variation === searchQuery.toLowerCase();
								const priority = isExactQuery ? 1000 : match.text.length;

								if (priority > bestMatchLength) {
									bestMatch = {
										content: message.content,
										matchStart: match.start,
										matchEnd: match.end,
										matchedText: match.text,
									};
									bestMatchLength = priority;

									// If we found exact query match, we're done
									if (isExactQuery) break;
								}
							}
						}

						// Stop if we found an exact match
						if (bestMatchLength >= 1000) break;
					}

					if (bestMatch) {
						const { content, matchStart, matchEnd } = bestMatch;
						matchedText = bestMatch.matchedText;

						// Create centered context around the match
						const maxContextLength = 160; // Maximum length of actual content (no padding)
						const matchLength = matchEnd - matchStart + 1;

						// Calculate context window - don't exceed maxContextLength even if content is longer
						const availableForContext = Math.min(maxContextLength, content.length) - matchLength;
						const contextPerSide = Math.floor(availableForContext / 2);

						// Calculate snippet boundaries to center the match within maxContextLength
						let snippetStart = Math.max(0, matchStart - contextPerSide);
						let snippetEnd = Math.min(content.length, matchStart + matchLength + contextPerSide);

						// Ensure we don't exceed maxContextLength
						if (snippetEnd - snippetStart > maxContextLength) {
							if (matchStart - contextPerSide < 0) {
								// Match is near start, extend end but limit to maxContextLength
								snippetEnd = Math.min(content.length, snippetStart + maxContextLength);
							} else {
								// Match is not near start, limit to maxContextLength from match start
								snippetEnd = Math.min(content.length, snippetStart + maxContextLength);
							}
						}

						// Adjust to word boundaries if possible (but don't move more than 15 chars)
						const originalStart = snippetStart;
						const originalEnd = snippetEnd;

						while (
							snippetStart > 0 &&
							content[snippetStart] !== " " &&
							content[snippetStart] !== "\n" &&
							originalStart - snippetStart < 15
						) {
							snippetStart--;
						}
						while (
							snippetEnd < content.length &&
							content[snippetEnd] !== " " &&
							content[snippetEnd] !== "\n" &&
							snippetEnd - originalEnd < 15
						) {
							snippetEnd++;
						}

						// Extract the content
						let extractedContent = content.substring(snippetStart, snippetEnd).trim();
						// Add ellipsis indicators only
						if (snippetStart > 0) {
							extractedContent = "..." + extractedContent;
						}
						if (snippetEnd < content.length) {
							extractedContent = extractedContent + "...";
						}

						matchedContent = extractedContent;
					} else {
						// Fallback: use beginning of the first message if no match found
						const firstMessage = conv.messages[0];
						if (firstMessage?.content) {
							const content = firstMessage.content;
							matchedContent = content.length > 200 ? content.substring(0, 200) + "..." : content;
							matchedText = searchQuery; // Fallback to search query
						}
					}

					return {
						_id: conv._id,
						id: conv._id,
						title: conv.title,
						content: matchedContent,
						matchedText,
						updatedAt: conv.updatedAt,
						model: conv.model,
						assistantId: conv.assistantId,
						modelTools: models.find((m) => m.id == conv.model)?.tools ?? false,
					};
				})
			);
		return Response.json(convs as GETSearchEndpointReturn);
	}
	return Response.json([]);
};
