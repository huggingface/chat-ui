import type {
	Endpoint,
	EndpointParameters,
	EndpointMessage,
	TextGenerationStreamOutputSimplified,
} from "../endpoints/endpoints";
import endpoints from "../endpoints/endpoints";
import type { ProcessedModel } from "../models";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { heuristicSelectRoute, MULTIMODAL_ROUTE, AGENTIC_ROUTE } from "./heuristics";
import { getRoutes, resolveRouteModels } from "./policy";
import { getApiToken } from "$lib/server/apiToken";
import {
	hasActiveToolsSelection,
	isRouterToolsBypassEnabled,
	pickToolsCapableModel,
} from "./toolsRoute";
import { getConfiguredMultimodalModelId } from "./multimodal";

const REASONING_BLOCK_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

// Cache models at module level to avoid redundant dynamic imports on every request
let cachedModels: ProcessedModel[] | undefined;

async function getModels(): Promise<ProcessedModel[]> {
	if (!cachedModels) {
		const mod = await import("../models");
		cachedModels = (mod as { models: ProcessedModel[] }).models;
	}
	return cachedModels;
}

/**
 * Custom error class that preserves HTTP status codes
 */
class HTTPError extends Error {
	constructor(
		message: string,
		public statusCode?: number
	) {
		super(message);
		this.name = "HTTPError";
	}
}

/**
 * Extract the actual error message and status from OpenAI SDK errors or other upstream errors
 */
function extractUpstreamError(error: unknown): { message: string; statusCode?: number } {
	// Check if it's an OpenAI APIError with structured error info
	if (error && typeof error === "object") {
		const err = error as Record<string, unknown>;

		// OpenAI SDK error with error.error.message and status
		if (
			err.error &&
			typeof err.error === "object" &&
			"message" in err.error &&
			typeof err.error.message === "string"
		) {
			return {
				message: err.error.message,
				statusCode: typeof err.status === "number" ? err.status : undefined,
			};
		}

		// HTTPError or error with statusCode
		if (typeof err.statusCode === "number" && typeof err.message === "string") {
			return { message: err.message, statusCode: err.statusCode };
		}

		// Error with status field
		if (typeof err.status === "number" && typeof err.message === "string") {
			return { message: err.message, statusCode: err.status };
		}

		// Direct error message
		if (typeof err.message === "string") {
			return { message: err.message };
		}
	}

	return { message: String(error) };
}

function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(REASONING_BLOCK_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

function stripReasoningFromMessage(message: EndpointMessage): EndpointMessage {
	const content =
		typeof message.content === "string" ? stripReasoningBlocks(message.content) : message.content;
	return {
		...message,
		content,
	};
}

/**
 * Create an Endpoint that performs heuristic-based route selection and then forwards
 * to the selected model (with fallbacks) using the OpenAI-compatible endpoint.
 */
export async function makeRouterEndpoint(routerModel: ProcessedModel): Promise<Endpoint> {
	return async function routerEndpoint(params: EndpointParameters) {
		const routes = await getRoutes();
		const sanitizedMessages = params.messages.map(stripReasoningFromMessage);
		const routerMultimodalEnabled =
			(config.LLM_ROUTER_ENABLE_MULTIMODAL || "").toLowerCase() === "true";
		const routerToolsEnabled = isRouterToolsBypassEnabled();
		const hasImageInput = sanitizedMessages.some((message) =>
			(message.files ?? []).some(
				(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
			)
		);
		// Tools are considered "active" if the client indicated any enabled MCP server
		const hasToolsActive = hasActiveToolsSelection(params.locals);

		// Helper to create an OpenAI endpoint for a specific candidate model id
		async function createCandidateEndpoint(candidateModelId: string): Promise<Endpoint> {
			// Try to use the real candidate model config if present in chat-ui's model list
			let modelForCall: ProcessedModel | undefined;
			try {
				const all = await getModels();
				modelForCall = all?.find((m) => m.id === candidateModelId || m.name === candidateModelId);
			} catch (e) {
				logger.warn({ err: String(e) }, "[router] failed to load models for candidate lookup");
			}

			if (!modelForCall) {
				// Fallback: clone router model with candidate id
				modelForCall = {
					...routerModel,
					id: candidateModelId,
					name: candidateModelId,
					displayName: candidateModelId,
				} as ProcessedModel;
			}

			return endpoints.openai({
				type: "openai",
				baseURL: (config.OPENAI_BASE_URL || "https://router.huggingface.co/v1").replace(/\/$/, ""),
				apiKey: getApiToken(params.locals),
				model: modelForCall,
				// Ensure streaming path is used
				streamingSupported: true,
			});
		}

		// Yield router metadata for immediate UI display, using the actual candidate
		async function* metadataThenStream(
			gen: AsyncGenerator<TextGenerationStreamOutputSimplified>,
			actualModel: string,
			selectedRoute: string
		) {
			yield {
				token: { id: 0, text: "", special: true, logprob: 0 },
				generated_text: null,
				details: null,
				routerMetadata: { route: selectedRoute, model: actualModel },
			};
			for await (const ev of gen) yield ev;
		}

		// Multimodal bypass: if enabled and images detected, route to multimodal model
		if (routerMultimodalEnabled && hasImageInput) {
			let multimodalCandidate: string | undefined;
			try {
				const all = await getModels();
				multimodalCandidate = getConfiguredMultimodalModelId(all);
			} catch (e) {
				logger.warn({ err: String(e) }, "[router] failed to load models for multimodal lookup");
			}
			if (!multimodalCandidate) {
				throw new Error(
					"Router multimodal is enabled but LLM_ROUTER_MULTIMODAL_MODEL is not correctly configured. Remove the image or configure a multimodal model via LLM_ROUTER_MULTIMODAL_MODEL."
				);
			}

			try {
				logger.info(
					{ route: MULTIMODAL_ROUTE, model: multimodalCandidate },
					"[router] multimodal input detected; routing to multimodal model"
				);
				const ep = await createCandidateEndpoint(multimodalCandidate);
				const gen = await ep({ ...params });
				return metadataThenStream(gen, multimodalCandidate, MULTIMODAL_ROUTE);
			} catch (e) {
				const { message, statusCode } = extractUpstreamError(e);
				logger.error(
					{
						route: MULTIMODAL_ROUTE,
						model: multimodalCandidate,
						err: message,
						...(statusCode && { status: statusCode }),
					},
					"[router] multimodal model failed"
				);
				throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
			}
		}

		// Tools bypass: if enabled and tools are active, route to tools model
		if (routerToolsEnabled && hasToolsActive) {
			let toolsModel: ProcessedModel | undefined;
			try {
				const all = await getModels();
				toolsModel = pickToolsCapableModel(all);
			} catch (e) {
				logger.warn({ err: String(e) }, "[router] failed to load models for tools lookup");
			}

			const toolsCandidate = toolsModel?.id ?? toolsModel?.name;
			if (toolsCandidate) {
				try {
					logger.info(
						{ route: AGENTIC_ROUTE, model: toolsCandidate },
						"[router] tools active; routing to tools model"
					);
					const ep = await createCandidateEndpoint(toolsCandidate);
					const gen = await ep({ ...params });
					return metadataThenStream(gen, toolsCandidate, AGENTIC_ROUTE);
				} catch (e) {
					const { message, statusCode } = extractUpstreamError(e);
					const logData = {
						route: AGENTIC_ROUTE,
						model: toolsCandidate,
						err: message,
						...(statusCode && { status: statusCode }),
					};
					if (statusCode === 402) {
						logger.warn(logData, "[router] tools model failed due to payment required");
					} else {
						logger.error(logData, "[router] tools model failed");
					}
					throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
				}
			}
			// No tools-capable model found — continue with default routing
		}

		// Heuristic-based route selection (no external API call)
		const routeSelection = await heuristicSelectRoute(sanitizedMessages, {
			hasImageInput,
			hasToolsActive,
		});

		const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || routerModel.id;
		const { candidates } = resolveRouteModels(routeSelection.routeName, routes, fallbackModel);

		let lastErr: unknown = undefined;
		for (const candidate of candidates) {
			try {
				logger.info(
					{ route: routeSelection.routeName, model: candidate },
					"[router] trying candidate"
				);
				const ep = await createCandidateEndpoint(candidate);
				const gen = await ep({ ...params });
				return metadataThenStream(gen, candidate, routeSelection.routeName);
			} catch (e) {
				lastErr = e;
				const { message: errMsg, statusCode: errStatus } = extractUpstreamError(e);
				logger.warn(
					{
						route: routeSelection.routeName,
						model: candidate,
						err: errMsg,
						...(errStatus && { status: errStatus }),
					},
					"[router] candidate failed"
				);
				continue;
			}
		}

		// Exhausted all candidates — throw to signal upstream failure
		// Forward the upstream error to the client
		const { message, statusCode } = extractUpstreamError(lastErr);
		throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
	};
}
