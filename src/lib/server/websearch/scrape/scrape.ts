import type { AppendUpdate } from "../runWebSearch";
import type { WebSearchScrapedSource, WebSearchSource } from "$lib/types/WebSearch";
import { loadPage } from "./playwright";

import { spatialParser } from "./parser";
import { htmlToMarkdownTree } from "../markdown/tree";

export const scrape =
	(appendUpdate: AppendUpdate, maxCharsPerElem: number) =>
	async (source: WebSearchSource): Promise<WebSearchScrapedSource | undefined> => {
		try {
			const page = await scrapeUrl(source.link, maxCharsPerElem);
			appendUpdate("Browsing webpage", [source.link]);
			return { ...source, page };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(`Failed to parse webpage: ${source.link}`, e);
			appendUpdate("Failed to parse webpage", [message, source.link], "error");
		}
	};

export async function scrapeUrl(url: string, maxCharsPerElem: number) {
	const page = await loadPage(url);

	const timeout = new Promise<never>((_, reject) =>
		setTimeout(() => reject(new Error("Timeout")), 2000)
	);
	return Promise.race([timeout, page.evaluate(spatialParser)])
		.then(({ elements, ...parsed }) => ({
			...parsed,
			markdownTree: htmlToMarkdownTree(parsed.title, elements, maxCharsPerElem),
		}))
		.catch((cause) => {
			throw Error("Spatial parsing failed", { cause });
		})
		.finally(() => page.close());
}
