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
import { archSelectRoute } from "./arch";
import { getRoutes, resolveRouteModels } from "./policy";
import { getApiToken } from "$lib/server/apiToken";

const REASONING_BLOCK_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

const ROUTER_MULTIMODAL_ROUTE = "multimodal";

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
		const err = error as any;

		// OpenAI SDK error with error.error.message and status
		if (err.error?.message) {
			return { message: err.error.message, statusCode: err.status };
		}

		// HTTPError or error with statusCode
		if (err.statusCode && err.message) {
			return { message: err.message, statusCode: err.statusCode };
		}

		// Error with status field
		if (err.status && err.message) {
			return { message: err.message, statusCode: err.status };
		}

		// Direct error message
		if (err.message) {
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
	const { reasoning: _reasoning, ...rest } = message;
	void _reasoning;
	const content =
		typeof message.content === "string" ? stripReasoningBlocks(message.content) : message.content;
	return {
		...rest,
		content,
	};
}

/**
 * Create an Endpoint that performs route selection via Arch and then forwards
 * to the selected model (with fallbacks) using the OpenAI-compatible endpoint.
 */
export async function makeRouterEndpoint(routerModel: ProcessedModel): Promise<Endpoint> {
	return async function routerEndpoint(params: EndpointParameters) {
		const routes = await getRoutes();
		const sanitizedMessages = params.messages.map(stripReasoningFromMessage);
		const routerMultimodalEnabled =
			(config.LLM_ROUTER_ENABLE_MULTIMODAL || "").toLowerCase() === "true";
		const hasImageInput = sanitizedMessages.some((message) =>
			(message.files ?? []).some(
				(file) => typeof file?.mime === "string" && file.mime.startsWith("image/")
			)
		);

		// Helper to create an OpenAI endpoint for a specific candidate model id
		async function createCandidateEndpoint(candidateModelId: string): Promise<Endpoint> {
			// Try to use the real candidate model config if present in chat-ui's model list
			let modelForCall: ProcessedModel | undefined;
			try {
				const mod = await import("../models");
				const all = (mod as { models: ProcessedModel[] }).models;
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

		async function findFirstMultimodalCandidateId(): Promise<string | undefined> {
			try {
				const mod = await import("../models");
				const all = (mod as { models: ProcessedModel[] }).models;
				const first = all?.find((m) => !m.isRouter && m.multimodal);
				return first?.id ?? first?.name;
			} catch (e) {
				logger.warn({ err: String(e) }, "[router] failed to load models for multimodal lookup");
				return undefined;
			}
		}

		if (routerMultimodalEnabled && hasImageInput) {
			const multimodalCandidate = await findFirstMultimodalCandidateId();
			if (!multimodalCandidate) {
				throw new Error(
					"No multimodal models are configured for the router. Remove the image or enable a multimodal model."
				);
			}

			try {
				logger.info(
					{ route: ROUTER_MULTIMODAL_ROUTE, model: multimodalCandidate },
					"[router] multimodal input detected; bypassing Arch selection"
				);
				const ep = await createCandidateEndpoint(multimodalCandidate);
				const gen = await ep({ ...params });
				return metadataThenStream(gen, multimodalCandidate, ROUTER_MULTIMODAL_ROUTE);
			} catch (e) {
				const { message, statusCode } = extractUpstreamError(e);
				logger.error(
					{
						route: ROUTER_MULTIMODAL_ROUTE,
						model: multimodalCandidate,
						err: message,
						...(statusCode && { status: statusCode }),
					},
					"[router] multimodal fallback failed"
				);
				throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
			}
		}

		const routeSelection = await archSelectRoute(sanitizedMessages, undefined, params.locals);

		// If arch router failed with an error, throw it immediately with status code
		if (routeSelection.routeName === "arch_router_failure" && routeSelection.error) {
			const { message, statusCode } = routeSelection.error;
			logger.error(
				{ err: message, ...(statusCode && { status: statusCode }) },
				"[router] arch router failed, propagating error"
			);
			throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
		}

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
		// Forward the actual upstream error directly to the client
		const { message, statusCode } = extractUpstreamError(lastErr);
		throw statusCode ? new HTTPError(message, statusCode) : new Error(message);
	};
}
