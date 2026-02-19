import type { OpenAiTool } from "$lib/server/mcp/tools";

export interface NativeTool {
	definition: OpenAiTool;
	execute(args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<string>;
}
