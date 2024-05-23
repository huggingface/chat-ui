import type { WebSearchScrapedSource, WebSearchSource } from "$lib/types/WebSearch";
import type { MessageWebSearchUpdate } from "$lib/types/MessageUpdate";
import { loadPage } from "./playwright";

import { spatialParser } from "./parser";
import { htmlToMarkdownTree } from "../markdown/tree";
import { timeout } from "$lib/utils/timeout";
import { makeErrorUpdate, makeGeneralUpdate } from "../update";

export const scrape = (maxCharsPerElem: number) =>
	async function* (
		source: WebSearchSource
	): AsyncGenerator<MessageWebSearchUpdate, WebSearchScrapedSource | undefined, undefined> {
		try {
			const page = await scrapeUrl(source.link, maxCharsPerElem);
			yield makeGeneralUpdate({ message: "Browsing webpage", args: [source.link] });
			return { ...source, page };
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			yield makeErrorUpdate({ message: "Failed to parse webpage", args: [message, source.link] });
		}
	};

export async function scrapeUrl(url: string, maxCharsPerElem: number) {
	const { res, page } = await loadPage(url);

	if (!res) throw Error("Failed to load page");

	// Check if it's a non-html content type that we can handle directly
	// TODO: direct mappings to markdown can be added for markdown, csv and others
	const contentType = res.headers()["content-type"] ?? "";
	if (
		contentType.includes("text/plain") ||
		contentType.includes("text/markdown") ||
		contentType.includes("application/json") ||
		contentType.includes("application/xml") ||
		contentType.includes("text/csv")
	) {
		const title = await page.title();
		const content = await page.content();
		return {
			title,
			markdownTree: htmlToMarkdownTree(
				title,
				[{ tagName: "p", attributes: {}, content: [content] }],
				maxCharsPerElem
			),
		};
	}

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
