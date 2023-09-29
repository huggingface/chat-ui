import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { chunk } from "$lib/utils/chunk";
import {
	MAX_SEQ_LEN as CHUNK_CAR_LEN,
	findSimilarSentences,
} from "$lib/server/websearch/sentenceSimilarity";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";

const MAX_N_PAGES_SCRAPE = 10 as const;
const MAX_N_PAGES_EMBED = 5 as const;

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
		appendUpdate("Searching Google", [webSearch.searchQuery]);
		const results = await searchWeb(webSearch.searchQuery);
		webSearch.results =
			(results.organic_results &&
				results.organic_results.map((el: { title: string; link: string }) => {
					const { title, link } = el;
					const { hostname } = new URL(link);
					return { title, link, hostname };
				})) ??
			[];
		webSearch.results = webSearch.results
			.filter(({ link }) => !link.includes("youtube.com")) // filter out youtube links
			.slice(0, MAX_N_PAGES_SCRAPE); // limit to first 10 links only

		let paragraphChunks: { source: WebSearchSource; text: string }[] = [];
		if (webSearch.results.length > 0) {
			appendUpdate("Browsing results");
			const promises = webSearch.results.map(async (result) => {
				const { link } = result;
				let text = "";
				try {
					text = await parseWeb(link);
					appendUpdate("Browsing webpage", [link]);
				} catch (e) {
					// ignore errors
				}
				const MAX_N_CHUNKS = 100;
				const texts = chunk(text, CHUNK_CAR_LEN).slice(0, MAX_N_CHUNKS);
				return texts.map((t) => ({ source: result, text: t }));
			});
			const nestedParagraphChunks = (await Promise.all(promises)).slice(0, MAX_N_PAGES_EMBED);
			paragraphChunks = nestedParagraphChunks.flat();
			if (!paragraphChunks.length) {
				throw new Error("No text found on the first 5 results");
			}
		} else {
			throw new Error("No results found for this search query");
		}

		appendUpdate("Extracting relevant information");
		const topKClosestParagraphs = 8;
		const texts = paragraphChunks.map(({ text }) => text);
		const indices = await findSimilarSentences(prompt, texts, {
			topK: topKClosestParagraphs,
		});
		webSearch.context = indices.map((idx) => texts[idx]).join("");

		const usedSources = new Set<string>();
		for (const idx of indices) {
			const { source } = paragraphChunks[idx];
			if (!usedSources.has(source.link)) {
				usedSources.add(source.link);
				webSearch.contextSources.push(source);
				updatePad({
					type: "webSearch",
					messageType: "sources",
					message: "sources",
					sources: webSearch.contextSources,
				});
			}
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
