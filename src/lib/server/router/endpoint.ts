import type { Endpoint, EndpointParameters, EndpointMessage } from "../endpoints/endpoints";
import endpoints from "../endpoints/endpoints";
import type { ProcessedModel } from "../models";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { archSelectRoute } from "./arch";
import { getRoutes, resolveRouteModels } from "./policy";

const REASONING_BLOCK_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

const ROUTER_MULTIMODAL_ROUTE = "multimodal";

function stripReasoningBlocks(text: string): string {
	const stripped = text.replace(REASONING_BLOCK_REGEX, "");
	return stripped === text ? text : stripped.trim();
}

function stripReasoningFromMessage(message: EndpointMessage): EndpointMessage {
	const { reasoning: _reasoning, ...rest } = message;
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
				const all = (mod as any).models as ProcessedModel[];
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
				apiKey: config.OPENAI_API_KEY || config.HF_TOKEN || "sk-",
				model: modelForCall,
				// Ensure streaming path is used
				streamingSupported: true,
			});
		}

		// Yield router metadata for immediate UI display, using the actual candidate
		async function* metadataThenStream(
			gen: AsyncGenerator<any>,
			actualModel: string,
			selectedRoute: string
		) {
			yield {
				token: { id: 0, text: "", special: true, logprob: 0 },
				generated_text: null,
				details: null,
				routerMetadata: { route: selectedRoute, model: actualModel },
			} as any;
			for await (const ev of gen) yield ev;
		}

		async function findFirstMultimodalCandidateId(): Promise<string | undefined> {
			try {
				const mod = await import("../models");
				const all = (mod as any).models as ProcessedModel[];
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
				logger.error(
					{ route: ROUTER_MULTIMODAL_ROUTE, model: multimodalCandidate, err: String(e) },
					"[router] multimodal fallback failed"
				);
				throw new Error(
					"Failed to call the configured multimodal model. Remove the image or try again later."
				);
			}
		}

		const { routeName } = await archSelectRoute(sanitizedMessages);

		const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || routerModel.id;
		const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);

		let lastErr: any = undefined;
		for (const candidate of candidates) {
			try {
				logger.info({ route: routeName, model: candidate }, "[router] trying candidate");
				const ep = await createCandidateEndpoint(candidate);
				const gen = await ep({ ...params });
				return metadataThenStream(gen, candidate, routeName);
			} catch (e) {
				lastErr = e;
				logger.warn(
					{ route: routeName, model: candidate, err: String(e) },
					"[router] candidate failed"
				);
				continue;
			}
		}

		// Exhausted all candidates — throw to signal upstream failure
		throw new Error(`Routing failed for route=${routeName}: ${String(lastErr)}`);
	};
}
