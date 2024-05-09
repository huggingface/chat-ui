import type { BackendTool } from ".";

const calculator: BackendTool = {
	name: "calculator",
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
	call: async (params) => {
		try {
			const blocks = params.equation.split("\n");
			const query = blocks[blocks.length - 1].replace(/[^-()\d/*+.]/g, "");

			return {
				key: "calculator",
				status: "success",
				value: eval(query),
			};
		} catch (e) {
			return {
				key: "calculator",
				status: "error",
				value: "Invalid expression",
			};
		}
	},
};

export default calculator;
