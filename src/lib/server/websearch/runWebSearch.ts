import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import type { WebSearch, WebResultNode } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { findSimilarSentences } from "$lib/server/websearch/sentenceSimilarity";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { createChildren, getRagContext, getLeafNodes } from "./autoMergeRetriever";

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

		let rootNodes: WebResultNode[] = [];
		if (webSearch.results.length > 0) {
			appendUpdate("Browsing results");
			const promises = webSearch.results.map(async (source) => {
				try {
					const node = await parseWeb(source);
					appendUpdate("Browsing webpage", [source.link]);
					return node;
				} catch (e) {
					// ignore errors
					return null;
				}
			});
			rootNodes = (await Promise.all(promises))
				.slice(0, MAX_N_PAGES_EMBED)
				.filter((node) => node !== null) as WebResultNode[];
			if (!rootNodes.length) {
				throw new Error("No text found on the first 5 results");
			}
		} else {
			throw new Error("No results found for this search query");
		}

		appendUpdate("Extracting relevant information");
		const CHUNK_LENGTHS = [512, 256, 128]; // units in words
		rootNodes = rootNodes.map((node) => createChildren(node, CHUNK_LENGTHS));
		const leafNodes = getLeafNodes(rootNodes);
		const topKClosestParagraphs = 8;
		const texts = Object.values(leafNodes).map(({ content }) => content);
		console.log(JSON.stringify({ prompt, texts }, null, 2));
		const indices = await findSimilarSentences(prompt, texts, {
			topK: topKClosestParagraphs,
		});
		const possibleContext = getRagContext(rootNodes, leafNodes, indices);
		// console.log("POSSIBLE CONTEXT", possibleContext);
		webSearch.context = possibleContext;
		// console.log(JSON.stringify(texts, null, 2));
		// console.log("Closest context are:", webSearch.context);

		// const usedSources = new Set<string>();
		// for (const idx of indices) {
		// 	const { source } = allNodes[idx];
		// 	if (!usedSources.has(source.link)) {
		// 		usedSources.add(source.link);
		// 		webSearch.contextSources.push(source);
		// 		updatePad({
		// 			type: "webSearch",
		// 			messageType: "sources",
		// 			message: "sources",
		// 			sources: webSearch.contextSources,
		// 		});
		// 	}
		// }
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
