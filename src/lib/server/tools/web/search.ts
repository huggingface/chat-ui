import type { ConfigTool } from "$lib/types/Tool";
import { runWebSearch } from "../../websearch/runWebSearch";

const websearch: ConfigTool = {
	type: "config",
	description: "Search the web for answers to the user's query",
	color: "blue",
	icon: "web",
	displayName: "Web Search",
	isOnByDefault: true,
	functions: [
		{
			name: "websearch",
			displayName: "Web Search",
			description:
				"Use this tool to search web pages for answers that will help answer the user's query. Only use this tool if you need specific resources from the internet.",
			endpoint: null,
			inputs: [
				{
					name: "query",
					type: "str",
					description:
						"A search query which will be used to fetch the most relevant snippets regarding the user's query",
					required: true,
				},
			],
			outputPath: null,
			outputType: "str",
			showOutput: false,
			async *call({ query }, { conv, assistant, messages }) {
				const webSearchToolResults = yield* runWebSearch(
					conv,
					messages,
					assistant?.rag,
					String(query)
				);
				const chunks = webSearchToolResults?.contextSources
					.map(({ context }) => context)
					.join("\n------------\n");

				return {
					outputs: [{ websearch: chunks }],
					display: false,
				};
			},
		},
	],
};

export default websearch;
