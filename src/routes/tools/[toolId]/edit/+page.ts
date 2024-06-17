import type { CommunityToolEditable } from "$lib/types/Tool.js";

export const load = async ({ parent }) => {
	const { tool } = await parent();

	if (tool.type === "config") {
		throw new Error("Cannot edit a config tool");
	}

	return { tool: tool satisfies CommunityToolEditable };
};
