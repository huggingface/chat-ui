import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { EndpointMessage } from "../endpoints/endpoints";
import type { RouteSelection } from "./types";
import { getRoutes } from "./policy";

/** Default route when no specific heuristic matches */
export const DEFAULT_ROUTE = "default";
export const MULTIMODAL_ROUTE = "multimodal";
export const AGENTIC_ROUTE = "agentic";

/**
 * Simple heuristic-based route selection.
 *
 * This replaces the Arch Router API call with local heuristics:
 * - If image input is detected → multimodal route
 * - If tools are active → agentic route
 * - Otherwise → default route
 *
 * The actual model selection is handled by the routes.json policy file.
 */
export async function heuristicSelectRoute(
	messages: EndpointMessage[],
	options: {
		hasImageInput?: boolean;
		hasToolsActive?: boolean;
	} = {}
): Promise<RouteSelection> {
	const { hasImageInput = false, hasToolsActive = false } = options;

	const routes = await getRoutes();

	// Check for multimodal input
	if (hasImageInput) {
		const multimodalExists = routes.some((r) => r.name === MULTIMODAL_ROUTE);
		if (multimodalExists) {
			logger.debug({ route: MULTIMODAL_ROUTE }, "[router] heuristic: image input detected");
			return { routeName: MULTIMODAL_ROUTE };
		}
	}

	// Check for tools/agentic
	if (hasToolsActive) {
		const agenticExists = routes.some((r) => r.name === AGENTIC_ROUTE);
		if (agenticExists) {
			logger.debug({ route: AGENTIC_ROUTE }, "[router] heuristic: tools active");
			return { routeName: AGENTIC_ROUTE };
		}
	}

	// Default route for general conversation
	const defaultRoute = config.LLM_ROUTER_DEFAULT_ROUTE || DEFAULT_ROUTE;
	const defaultExists = routes.some((r) => r.name === defaultRoute);

	if (defaultExists) {
		logger.debug({ route: defaultRoute }, "[router] heuristic: using default route");
		return { routeName: defaultRoute };
	}

	// Fallback to first available route
	if (routes.length > 0) {
		logger.debug({ route: routes[0].name }, "[router] heuristic: fallback to first route");
		return { routeName: routes[0].name };
	}

	// No routes configured - this shouldn't happen in normal operation
	logger.warn("[router] heuristic: no routes configured");
	return { routeName: DEFAULT_ROUTE };
}
