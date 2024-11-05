import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";
import { runWebSearch } from "../../websearch/runWebSearch";

const websearch: ConfigTool = {
	_id: new ObjectId("00000000000000000000000A"),
	type: "config",
	description: "Search the web for answers to the user's query",
	color: "blue",
	icon: "wikis",
	displayName: "Web Search",
	name: "websearch",
	endpoint: null,
	inputs: [
		{
			name: "query",
			type: "str",
			description:
				"A search query which will be used to fetch the most relevant snippets regarding the user's query",
			paramType: "required",
		},
	],
	outputComponent: null,
	outputComponentIdx: null,
	showOutput: false,
	async *call({ query }, { conv, assistant, messages }) {
		const webSearchToolResults = yield* runWebSearch(conv, messages, assistant?.rag, String(query));

		const webSearchContext = webSearchToolResults?.contextSources
			.map(({ context }, idx) => `Source [${idx + 1}]\n${context.trim()}`)
			.join("\n\n----------\n\n");

		return {
			outputs: [
				{
					websearch: webSearchContext,
				},
				{
					instructions:
						"When answering the question, if you use sources from the websearch results above, cite each index inline individually wrapped like: [1], [2] etc.",
				},
			],
			display: false,
		};
	},
};

export default websearch;
