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
		path: "$[*]",
	},
	markdown: {
		type: "str",
		path: "$[*]",
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
