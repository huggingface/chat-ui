import type { BackendTool } from ".";

const directlyAnswer: BackendTool = {
	name: "directly_answer",
	isOnByDefault: true,
	isHidden: true,
	isLocked: true,
	description: "Use this tool to let the user know you wish to answer directly",
	parameterDefinitions: {},
	async *call() {
		return {
			outputs: [],
			display: false,
		};
	},
};

export default directlyAnswer;
