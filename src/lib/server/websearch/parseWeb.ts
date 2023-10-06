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
	// const [nonMarkdown, markdown] = splitMarkdown(potentialMarkdown);
	const nonMdNode: WebResultNode = { content: potentialMarkdown, source };
	// const nodes = divideMarkdwonSections(markdown, source);
	// nodes.unshift(nonMdNode);
	return [nonMdNode];
}

function splitMarkdown(markdown: string): [string, string] {
	// divide into markdown and non-markdown sections
	const index = markdown.indexOf("# ");
	const beforeHeading = markdown.substring(0, index).trim();
	const afterHeading = index !== -1 ? markdown.substring(index).trim() : "";
	return [beforeHeading, afterHeading];
}

// return node of type {depth, content, children}[]
function divideMarkdwonSections(markdown: string, source: WebSearchSource): WebResultNode[] {
	const sections = markdown.split(/((#{1,6}) .+)\n/g);
	const nodes: WebResultNode[] = [];

	for (let i = 1; i < sections.length; i += 3) {
		const heading = sections[i + 0];
		const content = `${heading}\n\n${sections[i + 2]}`;
		const node: WebResultNode = { content, source };
		nodes.push(node);
	}

	return nodes;
}
