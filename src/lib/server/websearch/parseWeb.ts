import { load as cheerioLoad } from "cheerio";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";
import prettier from "prettier";
import type { WebSearchSource, WebResultNode } from "$lib/types/WebSearch";

const turndownService = new TurndownService();
turndownService.use(tables);

export async function parseWeb(source: WebSearchSource) {
	const { link } = source;
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const htmlString = await fetch(link, { signal: abortController.signal })
		.then((response) => response.text())
		.catch();

	const $ = cheerioLoad(htmlString);
	// Remove all CSS, including inline ones
	$("style").remove();
	$("*").removeAttr("style");
	// Remove all <script> elements within <body>
	$("body script").remove();
	// Replace links with just their text
	$("a").replaceWith((_idx, el) => {
		return $(el).text();
	});
	// Replace images with just their alt text
	$("img").replaceWith((_idx, el) => {
		return $(el).attr("alt") || "Image";
	});
	const markdownRaw = turndownService.turndown($("body").html());
	const potentialMarkdown: string = await prettier.format(markdownRaw, { parser: "markdown" });
	const node: WebResultNode = { content: potentialMarkdown, source };
	return node;
}
