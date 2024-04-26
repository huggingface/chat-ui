import type { BackendTool } from ".";
import { parseWeb } from "../websearch/parseWeb";

const fetchUrl: BackendTool = {
	name: "fetchUrl",
	description: "A tool that can be used to fetch an URL and return the content directly.",
	parameter_definitions: {
		url: {
			description: "The url that should be fetched.",
			type: "str",
			required: true,
		},
	},
	call: async (params) => {
		try {
			const blocks = params.url.split("\n");
			const url = blocks[blocks.length - 1];

			const content = await parseWeb(url);

			return {
				key: "fetchUrl",
				status: "success",
				value: content,
				display: false,
			};
		} catch (e) {
			return {
				key: "fetchUrl",
				status: "error",
				value: "Fetching the webpage failed because :" + (e as Error).message,
			};
		}
	},
};

export default fetchUrl;
