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
import { ROUTER_FAILURE } from "./types";

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

/**
 * Determines if an error is a policy/entitlement error that should be shown to users immediately
 * (vs transient errors that should trigger fallback)
 */
function isPolicyError(statusCode?: number): boolean {
	if (!statusCode) return false;
	// 402: Payment Required, 401: Unauthorized, 403: Forbidden
	return statusCode === 402 || statusCode === 401 || statusCode === 403;
}

/**
 * Sanitize error messages before sending to clients to avoid leaking provider details
 */
function publicErrorMessage(message: string, statusCode?: number): string {
	// Specific messages for known status codes
	if (statusCode === 402) return "Payment required to continue.";
	if (statusCode === 401) return "You are not authorized. Please sign in.";
	if (statusCode === 403) return "Access to this feature is restricted.";
	if (statusCode === 429) return "You're being rate-limited. Please try again shortly.";
	if (statusCode && statusCode >= 500)
		return "The AI provider is temporarily unavailable. Please try again.";

	// For other errors, sanitize by replacing provider names
	return message.replace(/OpenAI|Anthropic|Provider[A-Z]\w*/gi, "the AI provider");
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
				const publicMsg = publicErrorMessage(message, statusCode);
				logger.error(
					{
						route: ROUTER_MULTIMODAL_ROUTE,
						model: multimodalCandidate,
						err: message,
						...(statusCode && { status: statusCode }),
					},
					"[router] multimodal fallback failed"
				);
				throw statusCode ? new HTTPError(publicMsg, statusCode) : new Error(publicMsg);
			}
		}

		const routeSelection = await archSelectRoute(sanitizedMessages, undefined, params.locals);

		// If arch router failed with an error, only hard-fail for policy errors (402/401/403)
		// For transient errors (5xx, timeouts, network), allow fallback to continue
		if (routeSelection.routeName === ROUTER_FAILURE && routeSelection.error) {
			const { message, statusCode } = routeSelection.error;

			if (isPolicyError(statusCode)) {
				// Policy errors should be surfaced to the user immediately (e.g., subscription required)
				const publicMsg = publicErrorMessage(message, statusCode);
				logger.error(
					{ err: message, ...(statusCode && { status: statusCode }) },
					"[router] arch router failed with policy error, propagating to client"
				);
				throw statusCode ? new HTTPError(publicMsg, statusCode) : new Error(publicMsg);
			}

			// Transient errors: log and continue to fallback
			logger.warn(
				{ err: message, ...(statusCode && { status: statusCode }) },
				"[router] arch router failed with transient error, attempting fallback"
			);
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
		// Sanitize and forward the upstream error to the client
		const { message, statusCode } = extractUpstreamError(lastErr);
		const publicMsg = publicErrorMessage(message, statusCode);
		throw statusCode ? new HTTPError(publicMsg, statusCode) : new Error(publicMsg);
	};
}
