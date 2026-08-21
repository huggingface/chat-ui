import type { Conversation } from "$lib/types/Conversation";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { askUserQuestionBuiltin } from "./askUserQuestion";
import { createPlanTool } from "./planTool";
import type { BuiltinTool } from "./types";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";
export { PLAN_TOOL_NAME } from "./planTool";

/**
 * Enablement policy lives here, per tool — never in the dispatch or gate
 * plumbing, which treats every builtin the same. Both tools are part of the
 * ML Assistant preset: outside a mode conversation (or in a build without the
 * mode) there are no builtin tools at all.
 */
export function getEnabledBuiltinTools(params: {
	conv: Pick<Conversation, "_id" | "plan" | "mlAssistant">;
}): BuiltinTool[] {
	if (!isMlAssistantConversation(params.conv)) return [];
	return [askUserQuestionBuiltin, createPlanTool(params.conv)];
}

/**
 * The MCP flow used to bail whenever no MCP servers were selected, which also
 * withheld every builtin tool. Shared by all early-return sites so the rule
 * can't drift between them.
 */
export function shouldSkipMcpFlow(serverCount: number, builtinToolCount: number): boolean {
	return serverCount === 0 && builtinToolCount === 0;
}
