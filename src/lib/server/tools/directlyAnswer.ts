import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";

const directlyAnswer: ConfigTool = {
	_id: new ObjectId("00000000000000000000000D"),
	type: "config",
	description: "Answer the user's query directly",
	color: "blue",
	icon: "chat",
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
			inputs: [],
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
