import { searchWeb } from "$lib/server/websearch/searchWeb";
import { generateQuery } from "$lib/server/websearch/generateQuery";
import { parseWeb } from "$lib/server/websearch/parseWeb";
import { chunk } from "$lib/utils/chunk";
import { findSimilarSentences } from "$lib/server/sentenceSimilarity";
import { getWebSearchProvider } from "./searchWeb";
import { defaultEmbeddingModel, embeddingModels } from "$lib/server/embeddingModels";
import { WEBSEARCH_ALLOWLIST, WEBSEARCH_BLOCKLIST, ENABLE_LOCAL_FETCH } from "$env/static/private";

import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { Message } from "$lib/types/Message";
import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import type { Assistant } from "$lib/types/Assistant";

import { z } from "zod";
import JSON5 from "json5";
import { isURLLocal } from "../isURLLocal";

const MAX_N_PAGES_SCRAPE = 10 as const;
const MAX_N_PAGES_EMBED = 5 as const;

const listSchema = z.array(z.string()).default([]);

const allowList = listSchema.parse(JSON5.parse(WEBSEARCH_ALLOWLIST));
const blockList = listSchema.parse(JSON5.parse(WEBSEARCH_BLOCKLIST));

export async function runWebSearch(
	conv: Conversation,
	messages: Message[],
	updatePad: (upd: MessageUpdate) => void,
	ragSettings?: Assistant["rag"]
) {
	const prompt = messages[messages.length - 1].content;
	const webSearch: WebSearch = {
		prompt,
		searchQuery: "",
		results: [],
		contextSources: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	};

	function appendUpdate(message: string, args?: string[], type?: "error" | "update") {
		updatePad({ type: "webSearch", messageType: type ?? "update", message, args });
	}

	try {
		// if the assistant specified direct links, skip the websearch
		if (ragSettings && ragSettings?.allowedLinks.length > 0) {
			appendUpdate("Using links specified in Assistant");

			let linksToUse = [...ragSettings.allowedLinks];

			if (ENABLE_LOCAL_FETCH !== "true") {
				const localLinks = await Promise.all(
					linksToUse.map(async (link) => {
						try {
							const url = new URL(link);
							return await isURLLocal(url);
						} catch (e) {
							return true;
						}
					})
				);

				linksToUse = linksToUse.filter((_, index) => !localLinks[index]);
			}

			webSearch.results = linksToUse.map((link) => {
				return { link, hostname: new URL(link).hostname, title: "", text: "" };
			});
		} else {
			webSearch.searchQuery = await generateQuery(messages);
			const searchProvider = getWebSearchProvider();
			appendUpdate(`Searching ${searchProvider}`, [webSearch.searchQuery]);

			let filters = "";
			if (ragSettings && ragSettings?.allowedDomains.length > 0) {
				appendUpdate("Filtering on specified domains");
				filters += ragSettings.allowedDomains.map((item) => "site:" + item).join(" OR ");
			}

			// handle the global lists
			filters +=
				allowList.map((item) => "site:" + item).join(" OR ") +
				" " +
				blockList.map((item) => "-site:" + item).join(" ");

			webSearch.searchQuery = filters + " " + webSearch.searchQuery;

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
						appendUpdate("Failed to parse webpage", [(e as Error).message, link], "error");
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

		for (const idx of indices) {
			const { source } = paragraphChunks[idx];
			const contextWithId = { idx, text: texts[idx] };
			const usedSource = webSearch.contextSources.find((cSource) => cSource.link === source.link);
			if (usedSource) {
				usedSource.context.push(contextWithId);
			} else {
				webSearch.contextSources.push({ ...source, context: [contextWithId] });
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
