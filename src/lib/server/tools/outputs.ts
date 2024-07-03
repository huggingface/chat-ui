import type { ToolIOType, ToolOutputComponents } from "$lib/types/Tool";

export const ToolOutputPaths: Record<
	ToolOutputComponents,
	{
		type: ToolIOType;
		path: string;
	}
> = {
	textbox: {
		type: "str",
		path: "$[0]",
	},
	markdown: {
		type: "str",
		path: "$[0]",
	},
	image: {
		type: "file",
		path: "$[*].url",
	},
	gallery: {
		type: "file",
		path: "$[*][*].image.url",
	},
};
