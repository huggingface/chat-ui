import { config } from "$lib/server/config";
import type { ChatTemplateInput } from "$lib/types/Template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";

import JSON5 from "json5";
import { logger } from "$lib/server/logger";
import { makeRouterEndpoint } from "$lib/server/router/endpoint";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

const sanitizeJSONEnv = (val: string, fallback: string) => {
	const raw = (val ?? "").trim();
	const unquoted = raw.startsWith("`") && raw.endsWith("`") ? raw.slice(1, -1) : raw;
	return unquoted || fallback;
};

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
	providers: z.array(z.object({ supports_tools: z.boolean().optional() }).passthrough()).optional(),
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

type ModelConfig = z.infer<typeof modelConfig>;

const overrideEntrySchema = modelConfig
	.partial()
	.extend({
		id: z.string().optional(),
		name: z.string().optional(),
	})
	.refine((value) => Boolean((value.id ?? value.name)?.trim()), {
		message: "Model override entry must provide an id or name",
	});

type ModelOverride = z.infer<typeof overrideEntrySchema>;

// ggufModelsConfig unused in this build

// Source models exclusively from an OpenAI-compatible endpoint.
let modelsRaw: ModelConfig[] = [];

// Require explicit base URL; no implicit default here
const openaiBaseUrl = config.OPENAI_BASE_URL
	? config.OPENAI_BASE_URL.replace(/\/$/, "")
	: undefined;
const isHFRouter = openaiBaseUrl === "https://router.huggingface.co/v1";

if (openaiBaseUrl) {
	try {
		const baseURL = openaiBaseUrl;
		logger.info({ baseURL }, "[models] Using OpenAI-compatible base URL");

		// Canonical auth token is OPENAI_API_KEY; keep HF_TOKEN as legacy alias
		const authToken = config.OPENAI_API_KEY || config.HF_TOKEN || "";

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
						description: z.string().optional(),
						providers: z
							.array(z.object({ supports_tools: z.boolean().optional() }).passthrough())
							.optional(),
						architecture: z
							.object({
								input_modalities: z.array(z.string()).optional(),
							})
							.passthrough()
							.optional(),
					})
				),
			})
			.passthrough();

		const parsed = listSchema.parse(json);
		logger.info({ count: parsed.data.length }, "[models] Parsed models count");

		modelsRaw = parsed.data.map((m) => {
			let logoUrl: string | undefined = undefined;
			if (isHFRouter && m.id.includes("/")) {
				const org = m.id.split("/")[0];
				logoUrl = `https://huggingface.co/api/organizations/${encodeURIComponent(org)}/avatar?redirect=true`;
			}

			const inputModalities = (m.architecture?.input_modalities ?? []).map((modality) =>
				modality.toLowerCase()
			);
			const supportsImageInput =
				inputModalities.includes("image") || inputModalities.includes("vision");
			return {
				id: m.id,
				name: m.id,
				displayName: m.id,
				description: m.description,
				logoUrl,
				providers: m.providers,
				multimodal: supportsImageInput,
				multimodalAcceptedMimetypes: supportsImageInput ? ["image/*"] : undefined,
				endpoints: [
					{
						type: "openai" as const,
						baseURL,
						// apiKey will be taken from OPENAI_API_KEY or HF_TOKEN automatically
					},
				],
			} as ModelConfig;
		}) as ModelConfig[];
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

let modelOverrides: ModelOverride[] = [];
const overridesEnv = (Reflect.get(config, "MODELS") as string | undefined) ?? "";

if (overridesEnv.trim()) {
	try {
		modelOverrides = z
			.array(overrideEntrySchema)
			.parse(JSON5.parse(sanitizeJSONEnv(overridesEnv, "[]")));
	} catch (error) {
		logger.error(error, "[models] Failed to parse MODELS overrides");
	}
}

if (modelOverrides.length) {
	const overrideMap = new Map<string, ModelOverride>();
	for (const override of modelOverrides) {
		for (const key of [override.id, override.name]) {
			const trimmed = key?.trim();
			if (trimmed) overrideMap.set(trimmed, override);
		}
	}

	modelsRaw = modelsRaw.map((model) => {
		const override = overrideMap.get(model.id ?? "") ?? overrideMap.get(model.name ?? "");
		if (!override) return model;

		const { id, name, ...rest } = override;

		return {
			...model,
			...rest,
		};
	});
}

function getChatPromptRender(_m: ModelConfig): (inputs: ChatTemplateInput) => string {
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

const processModel = async (m: ModelConfig) => ({
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

const builtModels = await Promise.all(
	modelsRaw.map((e) =>
		processModel(e)
			.then(addEndpoint)
			.then(async (m) => ({
				...m,
				hasInferenceAPI: inferenceApiIds.includes(m.id ?? m.name),
				// router decoration added later
				isRouter: false as boolean,
			}))
	)
);

// Inject a synthetic router alias ("Omni") if Arch router is configured
const archBase = (config.LLM_ROUTER_ARCH_BASE_URL || "").trim();
const routerLabel = (config.PUBLIC_LLM_ROUTER_DISPLAY_NAME || "Omni").trim() || "Omni";
const routerLogo = (config.PUBLIC_LLM_ROUTER_LOGO_URL || "").trim();
const routerAliasId = (config.PUBLIC_LLM_ROUTER_ALIAS_ID || "omni").trim() || "omni";
const routerMultimodalEnabled =
	(config.LLM_ROUTER_ENABLE_MULTIMODAL || "").toLowerCase() === "true";

let decorated = builtModels as any[];

if (archBase) {
	// Build a minimal model config for the alias
	const aliasRaw: ModelConfig = {
		id: routerAliasId,
		name: routerAliasId,
		displayName: routerLabel,
		logoUrl: routerLogo || undefined,
		preprompt: "",
		endpoints: [
			{
				type: "openai" as const,
				baseURL: openaiBaseUrl!,
			},
		],
		// Keep the alias visible
		unlisted: false,
	} as any;

	if (routerMultimodalEnabled) {
		aliasRaw.multimodal = true;
		aliasRaw.multimodalAcceptedMimetypes = ["image/*"];
	}

	const aliasBase = await processModel(aliasRaw);
	// Create a self-referential ProcessedModel for the router endpoint
	let aliasModel: any = {};
	aliasModel = {
		...aliasBase,
		isRouter: true,
		// getEndpoint uses the router wrapper regardless of the endpoints array
		getEndpoint: async (): Promise<Endpoint> => makeRouterEndpoint(aliasModel),
	};

	// Put alias first
	decorated = [aliasModel, ...decorated];
}

export const models = decorated as typeof builtModels;

export type ProcessedModel = (typeof models)[number] & { isRouter?: boolean };

// super ugly but not sure how to make typescript happier
export const validModelIdSchema = z.enum(models.map((m) => m.id) as [string, ...string[]]);

export const defaultModel = models[0];

// Models that have been deprecated
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
