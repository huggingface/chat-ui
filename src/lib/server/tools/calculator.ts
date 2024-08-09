import type { ConfigTool } from "$lib/types/Tool";
import { ObjectId } from "mongodb";
import vm from "node:vm";

const calculator: ConfigTool = {
	_id: new ObjectId("00000000000000000000000C"),
	type: "config",
	description: "Calculate the result of a mathematical expression",
	color: "blue",
	icon: "code",
	displayName: "Calculator",
	name: "calculator",
	endpoint: null,
	inputs: [
		{
			name: "equation",
			type: "str",
			description:
				"A mathematical expression to be evaluated. The result of the expression will be returned.",
			paramType: "required",
		},
	],
	outputComponent: null,
	outputComponentIdx: null,
	showOutput: false,
	async *call({ equation }) {
		try {
			const blocks = String(equation).split("\n");
			const query = blocks[blocks.length - 1].replace(/[^-()\d/*+.]/g, "");

			return {
				outputs: [{ calculator: `${query} = ${vm.runInNewContext(query)}` }],
			};
		} catch (cause) {
			throw new Error("Invalid expression", { cause });
		}
	},
};

export default calculator;
