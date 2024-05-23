import type { AppendUpdate } from "../runWebSearch";
import type { WebSearchScrapedSource, WebSearchSource } from "$lib/types/WebSearch";
import { loadPage } from "./playwright";

import { spatialParser } from "./parser";
import { htmlToMarkdownTree } from "../markdown/tree";
import { timeout } from "$lib/utils/timeout";

export const scrape =
	(appendUpdate: AppendUpdate, maxCharsPerElem: number) =>
	async (source: WebSearchSource): Promise<WebSearchScrapedSource | undefined> => {
		try {
			const page = await scrapeUrl(source.link, maxCharsPerElem);
			appendUpdate("Browsing webpage", [source.link]);
			return { ...source, page };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			appendUpdate("Failed to parse webpage", [message, source.link], "error");
		}
	};

export async function scrapeUrl(url: string, maxCharsPerElem: number) {
	const page = await loadPage(url);

	return timeout(page.evaluate(spatialParser), 2000)
		.then(({ elements, ...parsed }) => ({
			...parsed,
			markdownTree: htmlToMarkdownTree(parsed.title, elements, maxCharsPerElem),
		}))
		.catch((cause) => {
			throw Error("Parsing failed", { cause });
		})
		.finally(() => page.close());
}
