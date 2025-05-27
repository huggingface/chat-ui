import { config } from "$lib/server/config";
import type { ChatTemplateInput } from "$lib/types/Template";
import { compileTemplate } from "$lib/utils/template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";
import { endpointTgi } from "./endpoints/tgi/endpointTgi";
import { sum } from "$lib/utils/sum";
import { embeddingModels, validateEmbeddingModelByName } from "./embeddingModels";

import type { PreTrainedTokenizer } from "@huggingface/transformers";

import JSON5 from "json5";
import { getTokenizer } from "$lib/utils/getTokenizer";
import { logger } from "$lib/server/logger";
import { type ToolInput } from "$lib/types/Tool";
import { fetchJSON } from "$lib/utils/fetchJSON";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { findRepoRoot } from "./findRepoRoot";
import { Template } from "@huggingface/jinja";
import { readdirSync } from "fs";

export const MODELS_FOLDER =
	config.MODELS_STORAGE_PATH ||
	join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), "models");

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
	tokenizer: z
		.union([
			z.string(),
			z.object({
				tokenizerUrl: z.string().url(),
				tokenizerConfigUrl: z.string().url(),
			}),
		])
		.optional(),
	datasetName: z.string().min(1).optional(),
	datasetUrl: z.string().url().optional(),
	preprompt: z.string().default(""),
	prepromptUrl: z.string().url().optional(),
	chatPromptTemplate: z.string().optional(),
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
	tools: z.boolean().default(false),
	unlisted: z.boolean().default(false),
	embeddingModel: validateEmbeddingModelByName(embeddingModels).optional(),
	/** Used to enable/disable system prompt usage */
	systemRoleSupported: z.boolean().default(true),
	reasoning: reasoningSchema.optional(),
});

const ggufModelsConfig = await Promise.all(
	readdirSync(MODELS_FOLDER)
		.filter((f) => f.endsWith(".gguf"))
		.map(async (f) => {
			return {
				name: f.replace(".gguf", ""),
				endpoints: [
					{
						type: "local" as const,
						modelPath: f,
					},
				],
			};
		})
);

const turnStringIntoLocalModel = z.preprocess((obj: unknown) => {
	if (typeof obj !== "string") return obj;

	const name = obj.startsWith("hf:") ? obj.split(":")[1] : obj;
	const displayName = obj.startsWith("hf:")
		? obj.split(":")[1].split("/").slice(0, 2).join("/")
		: obj.endsWith(".gguf")
			? obj.replace(".gguf", "")
			: obj;

	const modelPath = obj.includes("/") && !obj.startsWith("hf:") ? `hf:${obj}` : obj;

	return {
		name,
		displayName,
		endpoints: [
			{
				type: "local",
				modelPath,
			},
		],
	} satisfies z.input<typeof modelConfig>;
}, modelConfig);

let modelsRaw = z.array(turnStringIntoLocalModel).parse(JSON5.parse(config.MODELS ?? "[]"));

if (config.LOAD_GGUF_MODELS === "true" || modelsRaw.length === 0) {
	const parsedGgufModels = z.array(modelConfig).parse(ggufModelsConfig);
	modelsRaw = [...modelsRaw, ...parsedGgufModels];
}

async function getChatPromptRender(
	m: z.infer<typeof modelConfig>
): Promise<ReturnType<typeof compileTemplate<ChatTemplateInput>>> {
	if (m.endpoints?.some((e) => e.type === "local")) {
		const endpoint = m.endpoints?.find((e) => e.type === "local");
		const path = endpoint?.modelPath ?? `hf:${m.id ?? m.name}`;

		const { resolveModelFile, readGgufFileInfo } = await import("node-llama-cpp");

		const modelPath = await resolveModelFile(path, MODELS_FOLDER);

		const info = await readGgufFileInfo(modelPath, {
			readTensorInfo: false,
		});

		if (info.metadata.tokenizer.chat_template) {
			// compile with jinja
			const jinjaTemplate = new Template(info.metadata.tokenizer.chat_template);
			return (inputs: ChatTemplateInput) => {
				return jinjaTemplate.render({ ...m, ...inputs });
			};
		}
	}

	if (m.chatPromptTemplate) {
		return compileTemplate<ChatTemplateInput>(m.chatPromptTemplate, m);
	}
	let tokenizer: PreTrainedTokenizer;

	try {
		tokenizer = await getTokenizer(m.tokenizer ?? m.id ?? m.name);
	} catch (e) {
		// if fetching the tokenizer fails but it wasnt manually set, use the default template
		if (!m.tokenizer) {
			logger.warn(
				`No tokenizer found for model ${m.name}, using default template. Consider setting tokenizer manually or making sure the model is available on the hub.`,
				m
			);
			return compileTemplate<ChatTemplateInput>(
				"{{#if @root.preprompt}}<|im_start|>system\n{{@root.preprompt}}<|im_end|>\n{{/if}}{{#each messages}}{{#ifUser}}<|im_start|>user\n{{content}}<|im_end|>\n<|im_start|>assistant\n{{/ifUser}}{{#ifAssistant}}{{content}}<|im_end|>\n{{/ifAssistant}}{{/each}}",
				m
			);
		}

		logger.error(
			e,
			`Failed to load tokenizer ${
				m.tokenizer ?? m.id ?? m.name
			} make sure the model is available on the hub and you have access to any gated models.`
		);
		process.exit();
	}

	const renderTemplate = ({ messages, preprompt, tools, continueMessage }: ChatTemplateInput) => {
		let formattedMessages: {
			role: string;
			content: string;
			tool_calls?: { id: string; tool_call_id: string; output: string }[];
		}[] = messages.map((message) => ({
			content: message.content,
			role: message.from,
		}));

		if (!m.systemRoleSupported) {
			const firstSystemMessage = formattedMessages.find((msg) => msg.role === "system");
			formattedMessages = formattedMessages.filter((msg) => msg.role !== "system");

			if (
				firstSystemMessage &&
				formattedMessages.length > 0 &&
				formattedMessages[0].role === "user"
			) {
				formattedMessages[0].content =
					firstSystemMessage.content + "\n" + formattedMessages[0].content;
			}
		}

		if (preprompt && formattedMessages[0].role !== "system") {
			formattedMessages = [
				{
					role: m.systemRoleSupported ? "system" : "user",
					content: preprompt,
				},
				...formattedMessages,
			];
		}

		const mappedTools =
			tools?.map((tool) => {
				const inputs: Record<
					string,
					{
						type: ToolInput["type"];
						description: string;
						required: boolean;
					}
				> = {};

				for (const value of tool.inputs) {
					if (value.paramType !== "fixed") {
						inputs[value.name] = {
							type: value.type,
							description: value.description ?? "",
							required: value.paramType === "required",
						};
					}
				}

				return {
					name: tool.name,
					description: tool.description,
					parameter_definitions: inputs,
				};
			}) ?? [];

		const output = tokenizer.apply_chat_template(formattedMessages, {
			tokenize: false,
			add_generation_prompt: !continueMessage,
			tools: mappedTools.length ? mappedTools : undefined,
		});

		if (typeof output !== "string") {
			throw new Error("Failed to apply chat template, the output is not a string");
		}

		return output;
	};
	return renderTemplate;
}

const processModel = async (m: z.infer<typeof modelConfig>) => ({
	...m,
	chatPromptRender: await getChatPromptRender(m),
	id: m.id || m.name,
	displayName: m.displayName || m.name,
	preprompt: m.prepromptUrl ? await fetch(m.prepromptUrl).then((r) => r.text()) : m.preprompt,
	parameters: { ...m.parameters, stop_sequences: m.parameters?.stop },
});

const addEndpoint = (m: Awaited<ReturnType<typeof processModel>>) => ({
	...m,
	getEndpoint: async (): Promise<Endpoint> => {
		if (!m.endpoints) {
			return endpointTgi({
				type: "tgi",
				url: `${config.HF_API_ROOT}/${m.name}`,
				accessToken: config.HF_TOKEN ?? config.HF_ACCESS_TOKEN,
				weight: 1,
				model: m,
			});
		}
		const totalWeight = sum(m.endpoints.map((e) => e.weight));

		let random = Math.random() * totalWeight;

		for (const endpoint of m.endpoints) {
			if (random < endpoint.weight) {
				const args = { ...endpoint, model: m };

				switch (args.type) {
					case "tgi":
						return endpoints.tgi(args);
					case "local":
						return endpoints.local(args);
					case "inference-client":
						return endpoints.inferenceClient(args);
					case "anthropic":
						return endpoints.anthropic(args);
					case "anthropic-vertex":
						return endpoints.anthropicvertex(args);
					case "bedrock":
						return endpoints.bedrock(args);
					case "aws":
						return await endpoints.aws(args);
					case "openai":
						return await endpoints.openai(args);
					case "llamacpp":
						return endpoints.llamacpp(args);
					case "ollama":
						return endpoints.ollama(args);
					case "vertex":
						return await endpoints.vertex(args);
					case "genai":
						return await endpoints.genai(args);
					case "cloudflare":
						return await endpoints.cloudflare(args);
					case "cohere":
						return await endpoints.cohere(args);
					case "langserve":
						return await endpoints.langserve(args);
					default:
						// for legacy reason
						return endpoints.tgi(args);
				}
			}
			random -= endpoint.weight;
		}

		throw new Error(`Failed to select endpoint`);
	},
});

const inferenceApiIds = config.isHuggingChat
	? await fetchJSON<{ id: string }[]>(
			"https://huggingface.co/api/models?pipeline_tag=text-generation&inference=warm&filter=conversational"
		)
			.then((arr) => arr?.map((r) => r.id) || [])
			.catch(() => {
				logger.error("Failed to fetch inference API ids");
				return [];
			})
	: [];

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
			.parse(JSON5.parse(config.OLD_MODELS))
			.map((m) => ({ ...m, id: m.id || m.name, displayName: m.displayName || m.name }))
	: [];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export const taskModel = addEndpoint(
	config.TASK_MODEL
		? ((models.find((m) => m.name === config.TASK_MODEL) ||
				(await processModel(modelConfig.parse(JSON5.parse(config.TASK_MODEL))))) ??
				defaultModel)
		: defaultModel
);

export type BackendModel = Optional<
	typeof defaultModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted" | "tools" | "hasInferenceAPI"
>;
