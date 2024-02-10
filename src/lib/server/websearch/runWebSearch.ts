import { searchWeb } from "$lib/server/websearch/searchWeb";
import type { Message } from "$lib/types/Message";
import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { chunk } from "$lib/utils/chunk";
import { findSimilarSentences } from "$lib/server/sentenceSimilarity";
import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import { getWebSearchProvider } from "./searchWeb";
import { defaultEmbeddingModel, embeddingModels } from "$lib/server/embeddingModels";

const MAX_N_PAGES_SCRAPE = 10 as const;
const MAX_N_PAGES_EMBED = 5 as const;

import { WEBSEARCH_ALLOWLIST, WEBSEARCH_BLOCKLIST } from "$env/static/private";
import { z } from "zod";
import JSON5 from "json5";
import type { Assistant } from "$lib/types/Assistant";

const listSchema = z.array(z.string()).default([]);

const allowList = listSchema.parse(JSON5.parse(WEBSEARCH_ALLOWLIST));
const blockList = listSchema.parse(JSON5.parse(WEBSEARCH_BLOCKLIST));

export async function runWebSearch(
	conv: Conversation,
	prompt: string,
	updatePad: (upd: MessageUpdate) => void,
	ragSettings?: Assistant["rag"]
) {
	const messages = (() => {
		return [...conv.messages, { content: prompt, from: "user", id: crypto.randomUUID() }];
	})() satisfies Message[];

	const webSearch: WebSearch = {
		prompt,
		searchQuery: "",
		results: [],
		context: "",
		contextSources: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	function appendUpdate(message: string, args?: string[], type?: "error" | "update") {
		updatePad({ type: "webSearch", messageType: type ?? "update", message, args });
	}

	try {
		// if the assistant specified direct links, skip the websearch
		if (ragSettings && ragSettings?.links.length > 0) {
			appendUpdate("Using links specified in assistant directly. Skipping websearch");
			webSearch.results = ragSettings.links.map((link) => {
				return { link, hostname: new URL(link).hostname, title: "", text: "" };
			});
		} else {
			webSearch.searchQuery = await generateQuery(messages);
			const searchProvider = getWebSearchProvider();
			appendUpdate(`Searching ${searchProvider}`, [webSearch.searchQuery]);

			if (ragSettings && ragSettings?.allowList.length > 0) {
				appendUpdate("Filtering results to only domains specified in assistant");
				webSearch.searchQuery +=
					" " + ragSettings.allowList.map((item) => "site:" + item).join(" ");
			}

			// handle the global lists
			webSearch.searchQuery +=
				allowList.map((item) => "site:" + item).join(" ") +
				" " +
				blockList.map((item) => "-site:" + item).join(" ");

			const results = await searchWeb(webSearch.searchQuery);
			webSearch.results =
				(results.organic_results &&
					results.organic_results.map((el: { title?: string; link: string; text?: string }) => {
						try {
							const { title, link, text } = el;
							const { hostname } = new URL(link);
							return { title, link, hostname, text };
						} catch (e) {
							// Ignore Errors
							return null;
						}
					})) ??
				[];
		}

		webSearch.results = webSearch.results.filter((value) => value !== null);
		webSearch.results = webSearch.results
			.filter(({ link }) => !blockList.some((el) => link.includes(el))) // filter out blocklist links
			.slice(0, MAX_N_PAGES_SCRAPE); // limit to first 10 links only

		// fetch the model
		const embeddingModel =
			embeddingModels.find((m) => m.id === conv.embeddingModel) ?? defaultEmbeddingModel;

		if (!embeddingModel) {
			throw new Error(`Embedding model ${conv.embeddingModel} not available anymore`);
		}

		let paragraphChunks: { source: WebSearchSource; text: string }[] = [];
		if (webSearch.results.length > 0) {
			appendUpdate("Browsing results");
			const promises = webSearch.results.map(async (result) => {
				const { link } = result;
				let text = result.text ?? "";
				if (!text) {
					try {
						text = await parseWeb(link);
						appendUpdate("Browsing webpage", [link]);
					} catch (e) {
						// ignore errors
					}
				}
				const MAX_N_CHUNKS = 100;
				const texts = chunk(text, embeddingModel.chunkCharLength).slice(0, MAX_N_CHUNKS);
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
		const indices = await findSimilarSentences(embeddingModel, prompt, texts, {
			topK: topKClosestParagraphs,
		});
		webSearch.context = indices.map((idx) => texts[idx]).join("");

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
	} catch (searchError) {
		if (searchError instanceof Error) {
			appendUpdate("An error occurred", [JSON.stringify(searchError.message)], "error");
		}
	}

	return webSearch;
}
