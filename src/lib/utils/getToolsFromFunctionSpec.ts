import { tools, type BackendTool } from "$lib/server/tools";

export async function getToolsFromFunctionSpec(spec?: string): Promise<BackendTool[]> {
	if (!spec) return [];

	return tools;
}
