import type { EndpointMessage } from "../endpoints/endpoints";
import { logger } from "$lib/server/logger";
import { archSelectRoute } from "./arch";
import { getRoutes, resolveRouteModels } from "./policy";
import type { Route } from "./types";

const REASONING_BLOCK_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

export function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(REASONING_BLOCK_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

export function stripReasoningFromMessage(message: EndpointMessage): EndpointMessage {
	const clone = { ...message } as EndpointMessage & { reasoning?: string };
	if ("reasoning" in clone) delete clone.reasoning;
	const content =
		typeof message.content === "string" ? stripReasoningBlocks(message.content) : message.content;
	return {
		...clone,
		content,
	};
}

export async function selectRouteCandidates(
	messages: EndpointMessage[],
	fallbackModel: string,
	traceId?: string
): Promise<{ routeName: string; candidates: string[]; routes: Route[] }> {
	logger.debug({ fallbackModel, traceId }, "[router-selection] loading policy and selecting route");
	const routes = await getRoutes();
	const sanitized = messages.map(stripReasoningFromMessage);
	const { routeName } = await archSelectRoute(sanitized, traceId);
	logger.debug({ routeName, traceId }, "[router-selection] arch returned route");
	const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);
	if (!candidates.length) {
		logger.warn({ routeName }, "[router] no candidates resolved; falling back to supplied model");
		return { routeName, candidates: [fallbackModel], routes };
	}
	logger.debug({ routeName, candidates }, "[router-selection] resolved candidates");
	return { routeName, candidates, routes };
}
