import { ToolResultStatus } from "$lib/types/Tool";
import type { BackendTool } from ".";
import vm from "node:vm";

const calculator: BackendTool = {
	name: "query_calculator",
	displayName: "Calculator",
	description:
		"A simple calculator, takes a string containing a mathematical expression and returns the answer. Only supports +, -, *, ** (power) and /, as well as parenthesis ().",
	isOnByDefault: true,
	parameterDefinitions: {
		equation: {
			description:
				"The formula to evaluate. EXACTLY as you would plug into a calculator. No words, no letters, only numbers and operators. Letters will make the tool crash.",
			type: "formula",
			required: true,
		},
	},
	async *call(params) {
		try {
			const blocks = String(params.equation).split("\n");
			const query = blocks[blocks.length - 1].replace(/[^-()\d/*+.]/g, "");

			return {
				status: ToolResultStatus.Success,
				outputs: [{ calculator: `${query} = ${vm.runInNewContext(query)}` }],
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
