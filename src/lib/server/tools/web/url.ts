import { stringifyMarkdownElementTree } from "$lib/server/websearch/markdown/utils/stringify";
import { scrapeUrl } from "$lib/server/websearch/scrape/scrape";
import type { BackendTool } from "..";

const fetchUrl: BackendTool = {
	name: "fetch_url",
	displayName: "URL Fetcher",
	description: "A tool that can be used to fetch an URL and return the content directly.",
	parameterDefinitions: {
		url: {
			description: "The url that should be fetched.",
			type: "str",
			required: true,
		},
	},
	async *call(params) {
		const blocks = String(params.url).split("\n");
		const url = blocks[blocks.length - 1];

		const { title, markdownTree } = await scrapeUrl(url, Infinity);

		return {
			outputs: [{ title, text: stringifyMarkdownElementTree(markdownTree) }],
			display: false,
		};
	},
};

export default fetchUrl;
