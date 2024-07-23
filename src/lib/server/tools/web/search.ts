import type { BackendTool } from "..";
import { runWebSearch } from "../../websearch/runWebSearch";

const websearch: BackendTool = {
	name: "websearch",
	displayName: "Web Search",
	description:
		"Use this tool to search web pages for answers that will help answer the user's query. Only use this tool if you need specific resources from the internet.",
	parameterDefinitions: {
		query: {
			required: true,
			type: "string",
			description:
				"A search query which will be used to fetch the most relevant snippets regarding the user's query",
		},
	},
	async *call({ query }, { conv, assistant, messages }) {
		const webSearchToolResults = yield* runWebSearch(conv, messages, assistant?.rag, String(query));
		const chunks = webSearchToolResults?.contextSources
			.map(({ context }) => context)
			.join("\n------------\n");

		return {
			outputs: [{ websearch: chunks }],
			display: false,
		};
	},
};

export default websearch;
