import { stringifyMarkdownElementTree } from "$lib/server/websearch/markdown/utils/stringify";
import { scrapeUrl } from "$lib/server/websearch/scrape/scrape";
import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";

const fetchUrl: ConfigTool = {
	_id: new ObjectId("00000000000000000000000B"),
	type: "config",
	description: "Fetch the contents of a URL",
	color: "blue",
	icon: "cloud",
	displayName: "Fetch URL",
	name: "fetchUrl",
	endpoint: null,
	inputs: [
		{
			name: "url",
			type: "str",
			description: "The URL of the webpage to fetch",
			paramType: "required",
		},
	],
	outputComponent: null,
	outputComponentIdx: null,
	showOutput: false,
	async *call({ url }) {
		const blocks = String(url).split("\n");
		const urlStr = blocks[blocks.length - 1];

		const { title, markdownTree } = await scrapeUrl(urlStr, Infinity);

		return {
			outputs: [{ title, text: stringifyMarkdownElementTree(markdownTree) }],
			display: false,
		};
	},
};

export default fetchUrl;
