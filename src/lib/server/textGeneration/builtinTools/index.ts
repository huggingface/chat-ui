import type { Conversation } from "$lib/types/Conversation";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { askUserQuestionBuiltin } from "./askUserQuestion";
import { githubGroundingBuiltins } from "./githubGrounding";
import { createPlanTool } from "./planTool";
import { waitBuiltin } from "./waitTool";
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
	// The GitHub tools carry a second condition of their own — they withhold
	// themselves without a GITHUB_TOKEN — which is still policy, so it lives with
	// them rather than leaking a config read into this list.
	return [
		askUserQuestionBuiltin,
		createPlanTool(params.conv),
		waitBuiltin,
		...githubGroundingBuiltins(),
	];
}

/**
 * The MCP flow used to bail whenever no MCP servers were selected, which also
 * withheld every builtin tool. Shared by all early-return sites so the rule
 * can't drift between them.
 */
export function shouldSkipMcpFlow(serverCount: number, builtinToolCount: number): boolean {
	return serverCount === 0 && builtinToolCount === 0;
}
