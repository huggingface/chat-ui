import { config } from "$lib/server/config";
import type { ChatTemplateInput } from "$lib/types/Template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";

import JSON5 from "json5";
import { logger } from "$lib/server/logger";
import { fetchJSON } from "$lib/utils/fetchJSON";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

const reasoningSchema = z.union([
	z.object({
		type: z.literal("regex"), // everything is reasoning, extract the answer from the regex
		regex: z.string(),
	}),
	z.object({
		type: z.literal("tokens"), // use beginning and end tokens that define the reasoning portion of the answer
		beginToken: z.string(), // empty string means the model starts in reasoning mode
		endToken: z.string(),
	}),
	z.object({
		type: z.literal("summarize"), // everything is reasoning, summarize the answer
	}),
]);

const modelConfig = z.object({
	/** Used as an identifier in DB */
	id: z.string().optional(),
	/** Used to link to the model page, and for inference */
	name: z.string().default(""),
	displayName: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	logoUrl: z.string().url().optional(),
	websiteUrl: z.string().url().optional(),
	modelUrl: z.string().url().optional(),
	tokenizer: z.never().optional(),
	datasetName: z.string().min(1).optional(),
	datasetUrl: z.string().url().optional(),
	preprompt: z.string().default(""),
	prepromptUrl: z.string().url().optional(),
	chatPromptTemplate: z.never().optional(),
	promptExamples: z
		.array(
			z.object({
				title: z.string().min(1),
				prompt: z.string().min(1),
			})
		)
		.optional(),
	endpoints: z.array(endpointSchema).optional(),
	parameters: z
		.object({
			temperature: z.number().min(0).max(2).optional(),
			truncate: z.number().int().positive().optional(),
			max_new_tokens: z.number().int().positive().optional(),
			stop: z.array(z.string()).optional(),
			top_p: z.number().positive().optional(),
			top_k: z.number().positive().optional(),
			repetition_penalty: z.number().min(-2).max(2).optional(),
			presence_penalty: z.number().min(-2).max(2).optional(),
		})
		.passthrough()
		.optional(),
	multimodal: z.boolean().default(false),
	multimodalAcceptedMimetypes: z.array(z.string()).optional(),
	unlisted: z.boolean().default(false),
	embeddingModel: z.never().optional(),
	/** Used to enable/disable system prompt usage */
	systemRoleSupported: z.boolean().default(true),
	reasoning: reasoningSchema.optional(),
});

const ggufModelsConfig: Array<z.infer<typeof modelConfig>> = [];

// If OPENAI_BASE_URL (preferred) or OPENAI_MODEL_LIST_URL (legacy) is defined,
// source models exclusively from that OpenAI-compatible endpoint.
// Otherwise, fall back to MODELS env and optional GGUF auto-discovery.
let modelsRaw: z.infer<typeof modelConfig>[] = [];

// Prefer explicit base URL, then fall back to a full list URL
const openaiBaseUrl = (() => {
	if (config.OPENAI_BASE_URL) {
		return config.OPENAI_BASE_URL.replace(/\/$/, "");
	}
	if (config.OPENAI_MODEL_LIST_URL) {
		try {
			const listUrl = new URL(config.OPENAI_MODEL_LIST_URL);
			const basePath = listUrl.pathname.replace(/\/?models\/?$/, "");
			return `${listUrl.origin}${basePath}`.replace(/\/$/, "");
		} catch (e) {
			logger.error(e, "Invalid OPENAI_MODEL_LIST_URL provided");
		}
	}
	return undefined;
})();

if (openaiBaseUrl) {
	try {
		const baseURL = openaiBaseUrl;
		logger.info({ baseURL }, "[models] Using OpenAI-compatible base URL");
		// Prefer HF_TOKEN for Hugging Face router compatibility; otherwise use OPENAI_API_KEY
		const authToken = config.HF_TOKEN || config.OPENAI_API_KEY || "";

		// Try unauthenticated request first (many model lists are public, e.g. HF router)
		let response = await fetch(`${baseURL}/models`);
		logger.info({ status: response.status }, "[models] First fetch status");
		if (response.status === 401 || response.status === 403) {
			// Retry with Authorization header if available
			response = await fetch(`${baseURL}/models`, {
				headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
			});
			logger.info({ status: response.status }, "[models] Retried fetch status");
		}
		if (!response.ok) {
			throw new Error(
				`Failed to fetch ${baseURL}/models: ${response.status} ${response.statusText}`
			);
		}
		const json = await response.json();
		logger.info({ keys: Object.keys(json || {}) }, "[models] Response keys");

		const listSchema = z
			.object({
				data: z.array(
					z.object({
						id: z.string(),
						providers: z
							.array(z.object({ supports_tools: z.boolean().optional() }).passthrough())
							.optional(),
					})
				),
			})
			.passthrough();

		const parsed = listSchema.parse(json);
		logger.info({ count: parsed.data.length }, "[models] Parsed models count");

		modelsRaw = parsed.data.map((m) => ({
			id: m.id,
			name: m.id,
			displayName: m.id,
			endpoints: [
				{
					type: "openai" as const,
					baseURL,
					// apiKey will be taken from OPENAI_API_KEY or HF_TOKEN automatically
				},
			],
		})) as z.infer<typeof modelConfig>[];
	} catch (e) {
		logger.error(e, "Failed to load models from OpenAI base URL");
		throw e;
	}
} else {
	logger.error(
		"OPENAI_BASE_URL is required. Set it to an OpenAI-compatible base (e.g., https://router.huggingface.co/v1)."
	);
	throw new Error("OPENAI_BASE_URL not set");
}

function getChatPromptRender(
	m: z.infer<typeof modelConfig>
): (inputs: ChatTemplateInput) => string {
	// Minimal template to support legacy "completions" flow if ever used.
	// We avoid any tokenizer/Jinja usage in this build.
	return ({ messages, preprompt }) => {
		const parts: string[] = [];
		if (preprompt) parts.push(`[SYSTEM]\n${preprompt}`);
		for (const msg of messages) {
			const role = msg.from === "assistant" ? "ASSISTANT" : msg.from.toUpperCase();
			parts.push(`[${role}]\n${msg.content}`);
		}
		parts.push(`[ASSISTANT]`);
		return parts.join("\n\n");
	};
}

const processModel = async (m: z.infer<typeof modelConfig>) => ({
	...m,
	chatPromptRender: await getChatPromptRender(m),
	id: m.id || m.name,
	displayName: m.displayName || m.name,
	preprompt: m.prepromptUrl ? await fetch(m.prepromptUrl).then((r) => r.text()) : m.preprompt,
	parameters: { ...m.parameters, stop_sequences: m.parameters?.stop },
	unlisted: m.unlisted ?? false,
});

const addEndpoint = (m: Awaited<ReturnType<typeof processModel>>) => ({
	...m,
	getEndpoint: async (): Promise<Endpoint> => {
		if (!m.endpoints || m.endpoints.length === 0) {
			throw new Error("No endpoints configured. This build requires OpenAI-compatible endpoints.");
		}

		// Only support OpenAI-compatible endpoints in this build
		const endpoint = m.endpoints[0];
		if (endpoint.type !== "openai") {
			throw new Error("Only 'openai' endpoint type is supported in this build");
		}
		return await endpoints.openai({ ...endpoint, model: m });
	},
});

const inferenceApiIds: string[] = [];

export const models = await Promise.all(
	modelsRaw.map((e) =>
		processModel(e)
			.then(addEndpoint)
			.then(async (m) => ({
				...m,
				hasInferenceAPI: inferenceApiIds.includes(m.id ?? m.name),
			}))
	)
);

export type ProcessedModel = (typeof models)[number];

// super ugly but not sure how to make typescript happier
export const validModelIdSchema = z.enum(models.map((m) => m.id) as [string, ...string[]]);

export const defaultModel = models[0];

// Models that have been deprecated
const sanitizeJSONEnv = (val: string, fallback: string) => {
	const raw = (val ?? "").trim();
	const unquoted = raw.startsWith("`") && raw.endsWith("`") ? raw.slice(1, -1) : raw;
	return unquoted || fallback;
};

export const oldModels = config.OLD_MODELS
	? z
			.array(
				z.object({
					id: z.string().optional(),
					name: z.string().min(1),
					displayName: z.string().min(1).optional(),
					transferTo: validModelIdSchema.optional(),
				})
			)
			.parse(JSON5.parse(sanitizeJSONEnv(config.OLD_MODELS, "[]")))
			.map((m) => ({ ...m, id: m.id || m.name, displayName: m.displayName || m.name }))
	: [];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export const taskModel = addEndpoint(
	config.TASK_MODEL
		? (models.find((m) => m.name === config.TASK_MODEL || m.id === config.TASK_MODEL) ??
				defaultModel)
		: defaultModel
);

export type BackendModel = Optional<
	typeof defaultModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted" | "hasInferenceAPI"
>;
