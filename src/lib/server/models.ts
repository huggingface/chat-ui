import { config } from "$lib/server/config";
import type { ChatTemplateInput } from "$lib/types/Template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";

import JSON5 from "json5";
import { logger } from "$lib/server/logger";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

const sanitizeJSONEnv = (val: string, fallback: string) => {
	const raw = (val ?? "").trim();
	const unquoted = raw.startsWith("`") && raw.endsWith("`") ? raw.slice(1, -1) : raw;
	return unquoted || fallback;
};

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
			max_tokens: z.number().int().positive().optional(),
			stop: z.array(z.string()).optional(),
			stop_sequences: z.array(z.string()).optional(),
			top_p: z.number().positive().optional(),
			top_k: z.number().positive().optional(),
			frequency_penalty: z.number().min(-2).max(2).optional(),
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

const openaiBaseUrl = config.OPENAI_BASE_URL
	? config.OPENAI_BASE_URL.replace(/\/$/, "")
	: undefined;
const isHFRouter = openaiBaseUrl === "https://router.huggingface.co/v1";

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

function getChatPromptRender(_m: ModelConfig): (inputs: ChatTemplateInput) => string {
	// Minimal template to support legacy "completions" flow if ever used.
	// We avoid any tokenizer/Jinja usage in this build.
	return ({ messages, preprompt }) => {
		const parts: string[] = [];
		if (preprompt) {
			parts.push(`[SYSTEM]\n${preprompt}`);
		}
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
	parameters: m.parameters
		? { ...m.parameters, stop_sequences: m.parameters.stop }
		: { stop_sequences: undefined },
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

type InternalProcessedModel = Awaited<ReturnType<typeof addEndpoint>> & {
	isRouter: boolean;
	hasInferenceAPI: boolean;
};

const inferenceApiIds: string[] = [];

const getModelOverrides = (): ModelOverride[] => {
	const overridesEnv = (Reflect.get(config, "MODELS") as string | undefined) ?? "";

	if (!overridesEnv.trim()) {
		return [];
	}

	try {
		return z.array(overrideEntrySchema).parse(JSON5.parse(sanitizeJSONEnv(overridesEnv, "[]")));
	} catch (error) {
		logger.error(error, "[models] Failed to parse MODELS overrides");
		return [];
	}
};

export type ModelsRefreshSummary = {
	refreshedAt: Date;
	durationMs: number;
	added: string[];
	removed: string[];
	changed: string[];
	total: number;
};

export type ProcessedModel = InternalProcessedModel;

export let models: ProcessedModel[] = [];
export let defaultModel!: ProcessedModel;
export let taskModel!: ProcessedModel;
export let validModelIdSchema: z.ZodType<string> = z.string();
export let lastModelRefresh = new Date(0);
export let lastModelRefreshDurationMs = 0;
export let lastModelRefreshSummary: ModelsRefreshSummary = {
	refreshedAt: new Date(0),
	durationMs: 0,
	added: [],
	removed: [],
	changed: [],
	total: 0,
};

let inflightRefresh: Promise<ModelsRefreshSummary> | null = null;

const createValidModelIdSchema = (modelList: ProcessedModel[]): z.ZodType<string> => {
	if (modelList.length === 0) {
		throw new Error("No models available to build validation schema");
	}
	const ids = new Set(modelList.map((m) => m.id));
	return z.string().refine((value) => ids.has(value), "Invalid model id");
};

const resolveTaskModel = (modelList: ProcessedModel[]) => {
	if (modelList.length === 0) {
		throw new Error("No models available to select task model");
	}

	return modelList[0];
};

const signatureForModel = (model: ProcessedModel) =>
	JSON.stringify({
		description: model.description,
		displayName: model.displayName,
		providers: model.providers,
		parameters: model.parameters,
		preprompt: model.preprompt,
		prepromptUrl: model.prepromptUrl,
		endpoints:
			model.endpoints?.map((endpoint) => {
				if (endpoint.type === "openai") {
					const { type, baseURL } = endpoint;
					return { type, baseURL };
				}
				return { type: endpoint.type };
			}) ?? null,
		multimodal: model.multimodal,
		multimodalAcceptedMimetypes: model.multimodalAcceptedMimetypes,
		isRouter: model.isRouter,
		hasInferenceAPI: model.hasInferenceAPI,
	});

const applyModelState = (newModels: ProcessedModel[], startedAt: number): ModelsRefreshSummary => {
	if (newModels.length === 0) {
		throw new Error("Failed to load any models from upstream");
	}

	const previousIds = new Set(models.map((m) => m.id));
	const previousSignatures = new Map(models.map((m) => [m.id, signatureForModel(m)]));
	const refreshedAt = new Date();
	const durationMs = Date.now() - startedAt;

	models = newModels;
	defaultModel = models[0];
	taskModel = resolveTaskModel(models);
	validModelIdSchema = createValidModelIdSchema(models);
	lastModelRefresh = refreshedAt;
	lastModelRefreshDurationMs = durationMs;

	const added = newModels.map((m) => m.id).filter((id) => !previousIds.has(id));
	const removed = Array.from(previousIds).filter(
		(id) => !newModels.some((model) => model.id === id)
	);
	const changed = newModels
		.filter((model) => {
			const previousSignature = previousSignatures.get(model.id);
			return previousSignature !== undefined && previousSignature !== signatureForModel(model);
		})
		.map((model) => model.id);

	const summary: ModelsRefreshSummary = {
		refreshedAt,
		durationMs,
		added,
		removed,
		changed,
		total: models.length,
	};

	lastModelRefreshSummary = summary;

	logger.info(
		{
			total: summary.total,
			added: summary.added,
			removed: summary.removed,
			changed: summary.changed,
			durationMs: summary.durationMs,
		},
		"[models] Model cache refreshed"
	);

	return summary;
};

// Create a dummy model for fallback when API calls fail
const createDummyModel = async (): Promise<ProcessedModel> => {
	const dummyConfig: ModelConfig = {
		id: "dummy-model",
		name: "dummy-model",
		displayName: "Dummy Model",
		description: "A dummy model for testing purposes",
		logoUrl: undefined,
		websiteUrl: "https://huggingface.co",
		modelUrl: "https://huggingface.co",
		preprompt: "",
		promptExamples: [
			{ title: "Example 1", prompt: "Hello, how are you?" },
			{ title: "Example 2", prompt: "What is the weather today?" },
		],
		multimodal: false,
		unlisted: false,
		systemRoleSupported: true,
		endpoints: [
			{
				type: "openai" as const,
				weight: 1,
				baseURL: openaiBaseUrl || "https://api.openai.com/v1",
				apiKey: config.OPENAI_API_KEY || "sk-",
				completion: "chat_completions" as const,
				multimodal: {
					image: {
						supportedMimeTypes: ["image/png", "image/jpeg"],
						preferredMimeType: "image/jpeg",
						maxSizeInMB: 1,
						maxWidth: 1024,
						maxHeight: 1024,
					},
				},
				useCompletionTokens: false,
				streamingSupported: false,
			},
		],
		parameters: {
			temperature: 0.7,
			max_tokens: 1000,
			top_p: 0.9,
		},
	};

	const processed = await processModel(dummyConfig);
	const withEndpoint = await addEndpoint(processed);
	return {
		...withEndpoint,
		hasInferenceAPI: false,
		isRouter: false,
	} as ProcessedModel;
};

const buildModels = async (): Promise<ProcessedModel[]> => {
	if (!openaiBaseUrl) {
		logger.warn(
			"OPENAI_BASE_URL is not set. Using dummy model. Set it to an OpenAI-compatible base (e.g., https://router.huggingface.co/v1) to load real models."
		);
		return [await createDummyModel()];
	}

	try {
		const baseURL = openaiBaseUrl;
		logger.info({ baseURL }, "[models] Using OpenAI-compatible base URL");

		const authToken = config.OPENAI_API_KEY;

		// Use auth token from the start if available to avoid rate limiting issues
		// Some APIs rate-limit unauthenticated requests more aggressively
		const response = await fetch(`${baseURL}/models`, {
			headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
		});
		logger.info({ status: response.status }, "[models] First fetch status");
		if (!response.ok && response.status === 401 && !authToken) {
			// If we get 401 and didn't have a token, there's nothing we can do
			logger.warn(
				`Failed to fetch ${baseURL}/models: ${response.status} ${response.statusText} (no auth token available). Using dummy model.`
			);
			return [await createDummyModel()];
		}
		if (!response.ok) {
			logger.warn(
				`Failed to fetch ${baseURL}/models: ${response.status} ${response.statusText}. Using dummy model.`
			);
			return [await createDummyModel()];
		}
		const json = await response.json();
		logger.info({ keys: Object.keys(json || {}) }, "[models] Response keys");

		const parsed = listSchema.parse(json);
		logger.info({ count: parsed.data.length }, "[models] Parsed models count");

		let modelsRaw = parsed.data.map((m) => {
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
						// apiKey will be taken from OPENAI_API_KEY automatically
					},
				],
			} as ModelConfig;
		}) as ModelConfig[];

		const overrides = getModelOverrides();

		if (overrides.length) {
			const overrideMap = new Map<string, ModelOverride>();
			for (const override of overrides) {
				for (const key of [override.id, override.name]) {
					const trimmed = key?.trim();
					if (trimmed) {
						overrideMap.set(trimmed, override);
					}
				}
			}

			modelsRaw = modelsRaw.map((model) => {
				const override = overrideMap.get(model.id ?? "") ?? overrideMap.get(model.name ?? "");
				if (!override) {
					return model;
				}

				const { id, name, ...rest } = override;
				void id;
				void name;

				return {
					...model,
					...rest,
				};
			});
		}

		const builtModels = await Promise.all(
			modelsRaw.map((e) =>
				processModel(e)
					.then(addEndpoint)
					.then(async (m) => ({
						...m,
						hasInferenceAPI: inferenceApiIds.includes(m.id ?? m.name),
						isRouter: false as boolean,
					}))
			)
		);

		return builtModels;
	} catch (e) {
		logger.warn(e, "Failed to load models from OpenAI base URL. Using dummy model.");
		// Return dummy model instead of throwing to allow server to start
		return [await createDummyModel()];
	}
};

const rebuildModels = async (): Promise<ModelsRefreshSummary> => {
	const startedAt = Date.now();
	const newModels = await buildModels();
	return applyModelState(newModels, startedAt);
};

await rebuildModels();

export const refreshModels = async (): Promise<ModelsRefreshSummary> => {
	if (inflightRefresh) {
		return inflightRefresh;
	}

	inflightRefresh = rebuildModels().finally(() => {
		inflightRefresh = null;
	});

	return inflightRefresh;
};

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export type BackendModel = Optional<
	typeof defaultModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted" | "hasInferenceAPI"
>;
