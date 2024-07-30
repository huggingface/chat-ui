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
