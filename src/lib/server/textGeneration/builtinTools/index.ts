import { config } from "$lib/server/config";
import type { Conversation } from "$lib/types/Conversation";
import { askUserQuestionBuiltin } from "./askUserQuestion";
import { createPlanTool } from "./planTool";
import type { BuiltinTool } from "./types";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";
export { PLAN_TOOL_NAME } from "./planTool";

/**
 * Enablement policy lives here, per tool — never in the dispatch or gate
 * plumbing, which treats every builtin the same.
 */
export function getEnabledBuiltinTools(params: {
	model: { supportsTools?: boolean; supportsPlanning?: boolean; isRouter?: boolean };
	conv: Pick<Conversation, "_id" | "plan">;
}): BuiltinTool[] {
	const { model, conv } = params;
	const tools: BuiltinTool[] = [];

	if (config.DISABLE_ASK_USER_QUESTION !== "true") {
		tools.push(askUserQuestionBuiltin);
	}

	// Inferred default: any tools-capable model, behind the global switch. The
	// router alias reports supportsTools whenever router tools are on, which
	// would silently put planning on every routed conversation — so the alias
	// only gets it from an explicit supportsPlanning in its config.
	const planningEnabled =
		model.supportsPlanning ??
		(config.PLANNING_ENABLED === "true" && !model.isRouter && Boolean(model.supportsTools));
	if (planningEnabled) {
		tools.push(createPlanTool(conv));
	}

	return tools;
}

/**
 * The MCP flow used to bail whenever no MCP servers were selected, which also
 * withheld every builtin tool. Shared by all early-return sites so the rule
 * can't drift between them.
 */
export function shouldSkipMcpFlow(serverCount: number, builtinToolCount: number): boolean {
	return serverCount === 0 && builtinToolCount === 0;
}
