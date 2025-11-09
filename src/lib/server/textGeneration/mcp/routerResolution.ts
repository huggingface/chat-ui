import { config } from "$lib/server/config";
import { archSelectRoute } from "$lib/server/router/arch";
import { getRoutes, resolveRouteModels } from "$lib/server/router/policy";
import {
	hasActiveToolsSelection,
	isRouterToolsBypassEnabled,
	pickToolsCapableModel,
	ROUTER_TOOLS_ROUTE,
} from "$lib/server/router/toolsRoute";
import type { EndpointMessage } from "../../endpoints/endpoints";
import { stripReasoningFromMessageForRouting } from "../utils/routing";
import type { ProcessedModel } from "../../models";
import { logger } from "../../logger";

export interface RouterResolutionInput {
	model: ProcessedModel;
	messages: EndpointMessage[];
	conversationId: string;
	hasImageInput: boolean;
	locals: App.Locals | undefined;
}

export interface RouterResolutionResult {
	runMcp: boolean;
	targetModel: ProcessedModel;
	candidateModelId?: string;
	resolvedRoute?: string;
}

export async function resolveRouterTarget({
	model,
	messages,
	conversationId,
	hasImageInput,
	locals,
}: RouterResolutionInput): Promise<RouterResolutionResult> {
	let targetModel = model;
	let candidateModelId: string | undefined;
	let resolvedRoute: string | undefined;
	let runMcp = true;

	if (!model.isRouter) {
		return { runMcp, targetModel };
	}

	try {
		const mod = await import("../../models");
		const allModels = mod.models as ProcessedModel[];

		if (hasImageInput) {
			const multimodalCandidate = allModels?.find(
				(candidate) => !candidate.isRouter && candidate.multimodal
			);
			if (multimodalCandidate) {
				targetModel = multimodalCandidate;
				candidateModelId = multimodalCandidate.id ?? multimodalCandidate.name;
				resolvedRoute = "multimodal";
			} else {
				runMcp = false;
			}
		} else {
			// If tools are enabled and at least one MCP server is active, prefer a tools-capable model
			const toolsEnabled = isRouterToolsBypassEnabled();
			const hasToolsActive = hasActiveToolsSelection(locals);

			if (toolsEnabled && hasToolsActive) {
				const found = pickToolsCapableModel(allModels);
				if (found) {
					targetModel = found;
					candidateModelId = found.id ?? found.name;
					resolvedRoute = ROUTER_TOOLS_ROUTE;
					// Continue; runMcp remains true
					return { runMcp, targetModel, candidateModelId, resolvedRoute };
				}
				// No tools-capable model found; fall back to normal Arch routing below
			}
			const routes = await getRoutes();
			const sanitized = messages.map(stripReasoningFromMessageForRouting);
			const { routeName } = await archSelectRoute(sanitized, conversationId, locals);
			resolvedRoute = routeName;
			const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || model.id;
			const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);
			const primaryCandidateId = candidates[0];
			if (!primaryCandidateId || primaryCandidateId === fallbackModel) {
				runMcp = false;
			} else {
				const found = allModels?.find(
					(candidate) =>
						candidate.id === primaryCandidateId || candidate.name === primaryCandidateId
				);
				if (found) {
					targetModel = found;
					candidateModelId = primaryCandidateId;
				} else {
					runMcp = false;
				}
			}
		}
	} catch (error) {
		logger.warn({ err: String(error) }, "[mcp] routing preflight failed");
		runMcp = false;
	}

	return { runMcp, targetModel, candidateModelId, resolvedRoute };
}
