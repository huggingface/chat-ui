import type { BackendTool } from ".";

const websearch: BackendTool = {
	name: "websearch",
	description:
		"Use this tool to search web pages for answers that will help answer the user's query.",
	parameter_definitions: {
		query: {
			required: true,
			type: "string",
			description:
				"A search query which will be used to fetch the most relevant snippets regarding the user's query",
		},
	},
};

export default websearch;
