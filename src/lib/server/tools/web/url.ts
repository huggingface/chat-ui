import { stringifyMarkdownElementTree } from "$lib/server/websearch/markdown/utils/stringify";
import { scrapeUrl } from "$lib/server/websearch/scrape/scrape";
import type { ConfigTool } from "$lib/types/Tool";

const fetchUrl: ConfigTool = {
	type: "config",
	description: "Fetch the contents of a URL",
	color: "blue",
	icon: "web",
	displayName: "Fetch URL",
	isOnByDefault: true,
	functions: [
		{
			name: "fetchUrl",
			displayName: "Fetch URL",
			description:
				"Use this tool to fetch the contents of a URL. Only use this tool if you need to fetch the contents of a URL.",
			endpoint: null,
			inputs: {
				url: {
					type: "str",
					description: "The URL of the webpage to fetch",
					required: true,
				},
			},
			outputPath: null,
			outputType: "str",
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
		},
	],
};

export default fetchUrl;
