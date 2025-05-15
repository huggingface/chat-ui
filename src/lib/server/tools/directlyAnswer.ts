import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";

const directlyAnswer: ConfigTool = {
	_id: new ObjectId("00000000000000000000000D"),
	type: "config",
	description:
		"Answer the user's query directly. You must use this tool before you can answer the user's query.",
	color: "blue",
	icon: "chat",
	displayName: "Directly Answer",
	isOnByDefault: true,
	isLocked: true,
	isHidden: true,
	name: "directlyAnswer",
	endpoint: null,
	inputs: [],
	outputComponent: null,
	outputComponentIdx: null,
	showOutput: false,
	async *call() {
		return {
			outputs: [],
			display: false,
		};
	},
};

export default directlyAnswer;
