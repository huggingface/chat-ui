import { load as cheerioLoad } from "cheerio";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";
import prettier from "prettier";

const turndownService = new TurndownService();
turndownService.use(tables);

export async function parseWebintoMarkdown(url: string) {
	const abortController = new AbortController();
	setTimeout(() => abortController.abort(), 10000);
	const htmlString = await fetch(url, { signal: abortController.signal })
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
	const htmlBody = $("body").html();
	if (!htmlBody) {
		throw new Error(`Couldn't parse html body for ${url}`);
	}
	const markdownRaw = turndownService.turndown(htmlBody);
	const potentialMarkdown = prettier.format(markdownRaw, { parser: "markdown" });
	const markdown = getMarkdownSection(potentialMarkdown);
	if (!markdown) {
		throw new Error(`Couldn't parse markdown for ${url}`);
	}
	return markdown;
}

function getMarkdownSection(markdown: string) {
	const REGEX_MD_HEADING = /^#+\s/m;
	const idx = markdown.search(REGEX_MD_HEADING);
	const afterHeading = idx !== -1 ? markdown.substring(idx).trim() : "";
	return afterHeading;
}
