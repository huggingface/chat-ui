import { ToolResultStatus } from "$lib/types/Tool";
import type { BackendTool } from ".";

const calculator: BackendTool = {
	name: "query_calculator",
	displayName: "Calculator",
	description:
		"A simple calculator, takes a string containing a mathematical expression and returns the answer. Only supports +, -, *, and /, as well as parenthesis ().",
	isOnByDefault: true,
	parameter_definitions: {
		equation: {
			description:
				"The formula to evaluate. EXACTLY as you would plug into a calculator. No words, no letters, only numbers and operators. Letters will make the tool crash.",
			type: "formula",
			required: true,
		},
	},
	async *call(params) {
		try {
			const blocks = params.equation.split("\n");
			const query = blocks[blocks.length - 1].replace(/[^-()\d/*+.]/g, "");

			return {
				status: ToolResultStatus.Success,
				outputs: [{ calculator: Function(`return ${query}`)() }],
			};
		} catch (e) {
			return {
				status: ToolResultStatus.Error,
				message: "Invalid expression",
			};
		}
	},
};

export default calculator;
