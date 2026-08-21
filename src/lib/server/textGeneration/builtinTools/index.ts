import { config } from "$lib/server/config";
import type { Conversation } from "$lib/types/Conversation";
import { askUserQuestionBuiltin } from "./askUserQuestion";
import { createPlanTool } from "./planTool";
import type { BuiltinTool } from "./types";

export type { BuiltinTool, BuiltinToolContext, BuiltinToolResult } from "./types";
export { PLAN_TOOL_NAME } from "./planTool";

export type PlanningModelFlags = {
	supportsTools?: boolean;
	supportsPlanning?: boolean;
	isRouter?: boolean;
};

/**
 * The model-level planning default, before any per-user override. Inferred:
 * any tools-capable model, behind the global switch. The router alias reports
 * supportsTools whenever router tools are on, which would silently put
 * planning on every routed conversation — so the alias only gets it from an
 * explicit supportsPlanning in its config. Also what the model serializers
 * expose to the client, so the settings toggle shows the effective default.
 */
export function resolvePlanningDefault(model: PlanningModelFlags): boolean {
	return (
		model.supportsPlanning ??
		(config.PLANNING_ENABLED === "true" && !model.isRouter && Boolean(model.supportsTools))
	);
}

/**
 * Enablement policy lives here, per tool — never in the dispatch or gate
 * plumbing, which treats every builtin the same.
 */
export function getEnabledBuiltinTools(params: {
	model: PlanningModelFlags;
	conv: Pick<Conversation, "_id" | "plan">;
	/** Per-model user setting; wins over the resolved default in both directions. */
	planningOverride?: boolean;
}): BuiltinTool[] {
	const { model, conv, planningOverride } = params;
	const tools: BuiltinTool[] = [];

	if (config.DISABLE_ASK_USER_QUESTION !== "true") {
		tools.push(askUserQuestionBuiltin);
	}

	if (planningOverride ?? resolvePlanningDefault(model)) {
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
