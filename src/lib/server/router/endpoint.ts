import type { Endpoint, EndpointParameters, EndpointMessage } from "../endpoints/endpoints";
import endpoints from "../endpoints/endpoints";
import type { ProcessedModel } from "../models";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { archSelectRoute } from "./arch";
import { getRoutes, resolveRouteModels } from "./policy";

const REASONING_BLOCK_REGEX = /<think>[\s\S]*?(?:<\/think>|$)/g;

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
		const { routeName } = await archSelectRoute(sanitizedMessages);

		const fallbackModel = config.LLM_ROUTER_FALLBACK_MODEL || routerModel.id;
		const { candidates } = resolveRouteModels(routeName, routes, fallbackModel);

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
		async function* metadataThenStream(gen: AsyncGenerator<any>, actualModel: string) {
			yield {
				token: { id: 0, text: "", special: true, logprob: 0 },
				generated_text: null,
				details: null,
				routerMetadata: { route: routeName, model: actualModel },
			} as any;
			for await (const ev of gen) yield ev;
		}

		let lastErr: any = undefined;
		for (const candidate of candidates) {
			try {
				logger.info({ route: routeName, model: candidate }, "[router] trying candidate");
				const ep = await createCandidateEndpoint(candidate);
				const gen = await ep({ ...params });
				// Yield metadata with the actual candidate used
				return metadataThenStream(gen, candidate);
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
