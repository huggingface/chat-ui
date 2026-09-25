import type { Conversation } from "$lib/types/Conversation";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { mlVirtualFilesEnabled } from "$lib/server/mlFiles/enabled";
import { askUserQuestionBuiltin } from "./askUserQuestion";
import { githubGroundingBuiltins } from "./githubGrounding";
import { createPlanTool } from "./planTool";
import { waitBuiltin } from "./waitTool";
import { createResearchTool } from "./researchTool";
import { createSandboxTool } from "./sandboxTool";
import { createJobCheckTool } from "./jobCheckTool";
import { createTrackioTool } from "./createTrackioTool";
import { createFileTools } from "./fileTools";
import { createImportFileTool } from "./importFileTool";
import type { BuiltinTool } from "./types";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";
export { PLAN_TOOL_NAME } from "./planTool";
export { RESEARCH_TOOL_NAME, isResearchTool } from "./researchTool";
export { SANDBOX_TOOL_NAME, isSandboxTool } from "./sandboxTool";
export { JOB_CHECK_TOOL_NAME, isJobCheckTool } from "./jobCheckTool";
export { CREATE_TRACKIO_TOOL_NAME } from "./createTrackioTool";
export { WRITE_FILE_TOOL_NAME, EDIT_FILE_TOOL_NAME, READ_FILE_TOOL_NAME } from "./fileTools";
export { IMPORT_FILE_TOOL_NAME } from "./importFileTool";
export { isNestedAgentTool } from "./nestedAgent";

/**
 * Enablement policy lives here, per tool — never in the dispatch or gate
 * plumbing, which treats every builtin the same. All of these are part of the
 * ML Assistant preset: outside a mode conversation (or in a build without the
 * mode) there are no builtin tools at all.
 */
export function getEnabledBuiltinTools(params: {
	conv: Pick<Conversation, "_id" | "plan" | "mlAssistant">;
	/** Hub namespace to name a Trackio Space in; absent when the run has no user. */
	namespace?: string;
}): BuiltinTool[] {
	if (!isMlAssistantConversation(params.conv)) return [];
	// The GitHub tools carry a second condition of their own — they withhold
	// themselves without a GITHUB_TOKEN — which is still policy, so it lives with
	// them rather than leaking a config read into this list. The research tool's
	// definition is static too, but its nested loop needs the turn's request
	// plumbing, which runMcpFlow binds onto it once that exists.
	const virtualFiles = mlVirtualFilesEnabled(params.conv);
	return [
		askUserQuestionBuiltin,
		createPlanTool(params.conv),
		waitBuiltin,
		...githubGroundingBuiltins(),
		createResearchTool(),
		createSandboxTool({ virtualFiles }),
		createJobCheckTool({ virtualFiles }),
		createTrackioTool(() => params.namespace),
		...(virtualFiles ? [...createFileTools(params.conv), createImportFileTool(params.conv)] : []),
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
