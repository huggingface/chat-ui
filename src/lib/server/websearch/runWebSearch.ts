import { defaultEmbeddingModel, embeddingModels } from "$lib/server/embeddingModels";

import type { Conversation } from "$lib/types/Conversation";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { Message } from "$lib/types/Message";
import type { WebSearch, WebSearchScrapedSource } from "$lib/types/WebSearch";
import type { Assistant } from "$lib/types/Assistant";

import { search } from "./search/search";
import { scrape } from "./scrape/scrape";
import { findContextSources } from "./embed/embed";
import { removeParents } from "./markdown/tree";

const MAX_N_PAGES_TO_SCRAPE = 8 as const;
const MAX_N_PAGES_TO_EMBED = 5 as const;

export type AppendUpdate = (message: string, args?: string[], type?: "error" | "update") => void;
const makeAppendUpdate =
	(updatePad: (upd: MessageUpdate) => void): AppendUpdate =>
	(message, args, type) =>
		updatePad({ type: "webSearch", messageType: type ?? "update", message, args });

export async function runWebSearch(
	conv: Conversation,
	messages: Message[],
	updatePad: (upd: MessageUpdate) => void,
	ragSettings?: Assistant["rag"]
): Promise<WebSearch> {
	const prompt = messages[messages.length - 1].content;
	const createdAt = new Date();
	const updatedAt = new Date();
	const appendUpdate = makeAppendUpdate(updatePad);

	try {
		const embeddingModel =
			embeddingModels.find((m) => m.id === conv.embeddingModel) ?? defaultEmbeddingModel;
		if (!embeddingModel) {
			throw Error(`Embedding model ${conv.embeddingModel} not available anymore`);
		}

		// Search the web
		const { searchQuery, pages } = await search(messages, ragSettings, appendUpdate);
		if (pages.length === 0) throw Error("No results found for this search query");

		// Scrape pages
		appendUpdate("Browsing search results");

		const scrapedPages = await Promise.all(
			pages
				.slice(0, MAX_N_PAGES_TO_SCRAPE)
				.map(scrape(appendUpdate, embeddingModel.chunkCharLength))
		).then((allScrapedPages) =>
			allScrapedPages
				.filter((p): p is WebSearchScrapedSource => Boolean(p))
				.filter((p) => p.page.markdownTree.children.length > 0)
				.slice(0, MAX_N_PAGES_TO_EMBED)
		);

		if (!scrapedPages.length) {
			throw Error(`No text found in the first ${MAX_N_PAGES_TO_SCRAPE} results`);
		}

		// Chunk the text of each of the elements and find the most similar chunks to the prompt
		appendUpdate("Extracting relevant information");
		const contextSources = await findContextSources(scrapedPages, prompt, embeddingModel).then(
			(ctxSources) =>
				ctxSources.map((source) => ({
					...source,
					page: { ...source.page, markdownTree: removeParents(source.page.markdownTree) },
				}))
		);
		updatePad({
			type: "webSearch",
			messageType: "sources",
			message: "sources",
			sources: contextSources,
		});

		return {
			prompt,
			searchQuery,
			results: scrapedPages.map(({ page, ...source }) => ({
				...source,
				page: { ...page, markdownTree: removeParents(page.markdownTree) },
			})),
			contextSources,
			createdAt,
			updatedAt,
		};
	} catch (searchError) {
		const message = searchError instanceof Error ? searchError.message : String(searchError);
		console.error(message);
		appendUpdate("An error occurred", [JSON.stringify(message)], "error");
		return {
			prompt,
			searchQuery: "",
			results: [],
			contextSources: [],
			createdAt,
			updatedAt,
		};
	}
}
