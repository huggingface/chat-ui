import { ToolResultStatus } from "$lib/types/Tool";
import type { BackendTool } from ".";

const directlyAnswer: BackendTool = {
	name: "directly_answer",
	isOnByDefault: true,
	isHidden: true,
	isLocked: true,
	description:
		"Use this tool to let the user know you wish to answer directly. Do not try to provide any parameters when using this tool.",
	parameter_definitions: {},
	async *call() {
		return {
			status: ToolResultStatus.Success,
			outputs: [],
			display: false,
		};
	},
};

export default directlyAnswer;
