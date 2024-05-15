import { ToolResultStatus } from "$lib/types/Tool";
import type { BackendTool } from ".";
import { parseWeb } from "../websearch/parseWeb";

const fetchUrl: BackendTool = {
	name: "fetchUrl",
	displayName: "URL Fetcher",
	description: "A tool that can be used to fetch an URL and return the content directly.",
	isOnByDefault: true,
	parameter_definitions: {
		url: {
			description: "The url that should be fetched.",
			type: "str",
			required: true,
		},
	},
	async *call(params) {
		const blocks = params.url.split("\n");
		const url = blocks[blocks.length - 1];

		const content = await parseWeb(url);

		return {
			status: ToolResultStatus.Success,
			outputs: [{ fetchUrl: content }],
			display: false,
		};
	},
};

export default fetchUrl;
