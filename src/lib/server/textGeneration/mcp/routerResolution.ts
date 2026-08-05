import { config } from "$lib/server/config";
import {
	heuristicSelectRoute,
	MULTIMODAL_ROUTE,
	AGENTIC_ROUTE,
} from "$lib/server/router/heuristics";
import { getRoutes, resolveRouteModels } from "$lib/server/router/policy";
import {
	hasActiveToolsSelection,
	isRouterToolsBypassEnabled,
	pickToolsCapableModel,
} from "$lib/server/router/toolsRoute";
import { findConfiguredMultimodalModel } from "$lib/server/router/multimodal";
import { getFreeUserModel, resolveUserTier } from "$lib/server/router/userTier";
import type { ProcessedModel } from "../../models";
import { logger } from "../../logger";

export interface RouterResolutionInput {
	model: ProcessedModel;
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

		// Multimodal bypass (applies to free users too — the free-tier model is text-only,
		// so image requests keep the regular multimodal model)
		if (hasImageInput) {
			const multimodalCandidate = findConfiguredMultimodalModel(allModels);
			if (!multimodalCandidate) {
				runMcp = false;
				logger.warn(
					{ configuredModel: config.LLM_ROUTER_MULTIMODAL_MODEL },
					"[mcp] multimodal input but configured model missing or invalid; skipping MCP route"
				);
			} else {
				targetModel = multimodalCandidate;
				candidateModelId = multimodalCandidate.id ?? multimodalCandidate.name;
				resolvedRoute = MULTIMODAL_ROUTE;
			}
			return { runMcp, targetModel, candidateModelId, resolvedRoute };
		}

		// Resolved after the multimodal bypass, which is tier-independent — image requests
		// never pay for the billing lookup.
		const tier = await resolveUserTier(locals);

		// Tools bypass. Free users skip it and get pinned to the free-tier model by the
		// heuristic path below, which still reports the agentic route.
		const toolsEnabled = isRouterToolsBypassEnabled();
		const hasToolsActive = hasActiveToolsSelection(locals);

		if (toolsEnabled && hasToolsActive && tier !== "free") {
			const found = pickToolsCapableModel(allModels);
			if (found) {
				targetModel = found;
				candidateModelId = found.id ?? found.name;
				resolvedRoute = AGENTIC_ROUTE;
				return { runMcp, targetModel, candidateModelId, resolvedRoute };
			}
			// No tools-capable model found; fall back to default routing below
		}

		// Heuristic-based route selection (no external API call). Tools-active is masked by
		// the bypass flag so disabling tools keeps the agentic route off the heuristic path
		// too (image input has already returned above and is implicitly false here).
		const routes = await getRoutes();
		const { routeName } = await heuristicSelectRoute({
			hasImageInput,
			hasToolsActive: toolsEnabled && hasToolsActive,
		});
		resolvedRoute = routeName;

		// Free-tier users skip the route policy and get pinned to the configured cheap model;
		// if it can't be resolved, runMcp=false defers to the plain-generation router path.
		let primaryCandidateId: string | undefined;
		if (tier === "free") {
			primaryCandidateId = getFreeUserModel();
		} else {
			const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || model.id;
			const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);
			primaryCandidateId =
				candidates[0] && candidates[0] !== fallbackModel ? candidates[0] : undefined;
		}

		if (!primaryCandidateId) {
			runMcp = false;
		} else {
			const found = allModels?.find(
				(candidate) => candidate.id === primaryCandidateId || candidate.name === primaryCandidateId
			);
			if (found) {
				targetModel = found;
				candidateModelId = primaryCandidateId;
			} else {
				runMcp = false;
			}
		}
	} catch (error) {
		logger.warn({ err: String(error) }, "[mcp] routing preflight failed");
		runMcp = false;
	}

	return { runMcp, targetModel, candidateModelId, resolvedRoute };
}
