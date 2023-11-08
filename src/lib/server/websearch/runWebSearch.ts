import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import type { TextWithSource, WebSearch } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWebintoMarkdown } from "$lib/server/websearch/parseWeb";
import {
	SIMILARITY_SCORE_THRESHOLD,
	findSimilarSentences,
} from "$lib/server/websearch/sentenceSimilarity";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { parseMarkdown, chunkSlidingWindow } from "./slidingWindowChunker";
import { getWebSearchProvider } from "./searchWeb";

const MAX_N_PAGES_SCRAPE = 20 as const;
const MAX_N_PAGES_EMBED = 5 as const;
const MAX_N_CHUNKS_PER_SOURCE = 40 as const;

export async function runWebSearch(
	conv: Conversation,
	prompt: string,
	updatePad: (upd: MessageUpdate) => void
) {
	const messages = (() => {
		return [...conv.messages, { content: prompt, from: "user", id: crypto.randomUUID() }];
	})() satisfies Message[];

	const webSearch: WebSearch = {
		prompt: prompt,
		searchQuery: "",
		results: [],
		context: "",
		contextSources: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	function appendUpdate(message: string, args?: string[], type?: "error" | "update") {
		updatePad({ type: "webSearch", messageType: type ?? "update", message: message, args: args });
	}

	try {
		webSearch.searchQuery = await generateQuery(messages);
		const searchProvider = getWebSearchProvider();
		appendUpdate(`Searching ${searchProvider}`, [webSearch.searchQuery]);
		const results = await searchWeb(webSearch.searchQuery);
		webSearch.results =
			(results.organic_results &&
				results.organic_results.map((el: { title: string; link: string; text?: string }) => {
					const { title, link, text } = el;
					const { hostname } = new URL(link);
					return { title, link, hostname, text };
				})) ??
			[];
		webSearch.results = webSearch.results
			.filter(({ link }) => !link.includes("youtube.com")) // filter out youtube links
			.slice(0, MAX_N_PAGES_SCRAPE);

		if (!webSearch.results.length) {
			throw new Error("No results found for this search query");
		}

		let paragraphChunks: TextWithSource[] = [];

		while (webSearch.results.length) {
			const webSources = webSearch.results.slice(0, MAX_N_PAGES_EMBED);
			webSearch.results = webSearch.results.slice(MAX_N_PAGES_EMBED);
			appendUpdate("Browsing results");
			const promises = webSources.map(async (source) => {
				const { link } = source;
				let markdown = source.text ?? "";
				if (!markdown) {
					try {
						markdown = await parseWebintoMarkdown(link);
						appendUpdate("Browsing webpage", [link]);
					} catch (e) {
						// ignore errors
					}
				}
				return { text: markdown, source } as TextWithSource;
			});
			// chunk and do all the things here
			const markdownsWithSource = await Promise.all(promises);
			// increasee the character limit there
			const markdownFlatNodes = markdownsWithSource.map((item) => parseMarkdown(item)).flat();
			paragraphChunks = chunkSlidingWindow(markdownFlatNodes, {
				windowWidth: 1024,
				paddingWidth: 100,
			}).slice(0, MAX_N_CHUNKS_PER_SOURCE);

			appendUpdate("Extracting relevant information");
			const topKClosestParagraphs = 5;
			const texts = paragraphChunks.map(({ text }) => text);
			const similarityResults = await findSimilarSentences(prompt, texts, {
				topK: topKClosestParagraphs,
			});

			// if there was no similar text chunks to the query, embed the next set of web pages
			if (similarityResults[0].score > SIMILARITY_SCORE_THRESHOLD) {
				continue;
			}

			const indices = similarityResults.map((item) => item.index);
			webSearch.context = indices.map((idx) => texts[idx]).join(" ");

			const usedSources = new Set<string>();
			for (const idx of indices) {
				const { source } = paragraphChunks[idx];
				if (!usedSources.has(source.link)) {
					usedSources.add(source.link);
					webSearch.contextSources.push(source);
				}
			}
			updatePad({
				type: "webSearch",
				messageType: "sources",
				message: "sources",
				sources: webSearch.contextSources,
			});

			// break from the loop of creating emebddings for web pages
			break;
		}

		if (!webSearch.context) {
			throw new Error("Web search couldn't find relevant information.");
		}
	} catch (searchError) {
		if (searchError instanceof Error) {
			appendUpdate(
				"An error occurred with the web search",
				[JSON.stringify(searchError.message)],
				"error"
			);
		}
	}

	return webSearch;
}
