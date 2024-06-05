import type { ConfigTool } from "$lib/types/Tool";

const directlyAnswer: ConfigTool = {
	type: "config",
	description: "Answer the user's query directly",
	color: "blue",
	icon: "bubble",
	displayName: "Directly Answer",
	isOnByDefault: true,
	isLocked: true,
	isHidden: true,
	functions: [
		{
			name: "directlyAnswer",
			displayName: "Directly Answer",
			description:
				"Use this tool to answer the user's query directly. Only use this tool if you need to answer the user's query directly.",
			endpoint: null,
			inputs: {},
			outputPath: null,
			outputType: "str",
			showOutput: false,
			async *call() {
				return {
					outputs: [],
					display: false,
				};
			},
		},
	],
};

export default directlyAnswer;
