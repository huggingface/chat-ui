import {
	HF_TOKEN,
	HF_API_ROOT,
	MODELS,
	OLD_MODELS,
	TASK_MODEL,
	HF_ACCESS_TOKEN,
} from "$env/static/private";
import type { ChatTemplateInput } from "$lib/types/Template";
import { compileTemplate } from "$lib/utils/template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";
import endpointTgi from "./endpoints/tgi/endpointTgi";
import { sum } from "$lib/utils/sum";
import { embeddingModels, validateEmbeddingModelByName } from "./embeddingModels";

import type { PreTrainedTokenizer } from "@xenova/transformers";

import JSON5 from "json5";
import { getTokenizer } from "$lib/utils/getTokenizer";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

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
			temperature: z.number().min(0).max(1).optional(),
			truncate: z.number().int().positive().optional(),
			max_new_tokens: z.number().int().positive().optional(),
			stop: z.array(z.string()).optional(),
			top_p: z.number().positive().optional(),
			top_k: z.number().positive().optional(),
			repetition_penalty: z.number().min(-2).max(2).optional(),
		})
		.passthrough()
		.optional(),
	multimodal: z.boolean().default(false),
	unlisted: z.boolean().default(false),
	embeddingModel: validateEmbeddingModelByName(embeddingModels).optional(),
});

const modelsRaw = z.array(modelConfig).parse(JSON5.parse(MODELS));

async function getChatPromptRender(
	m: z.infer<typeof modelConfig>
): Promise<ReturnType<typeof compileTemplate<ChatTemplateInput>>> {
	if (m.chatPromptTemplate) {
		return compileTemplate<ChatTemplateInput>(m.chatPromptTemplate, m);
	}
	let tokenizer: PreTrainedTokenizer;

	if (!m.tokenizer) {
		return compileTemplate<ChatTemplateInput>(
			"{{#if @root.preprompt}}<|im_start|>system\n{{@root.preprompt}}<|im_end|>\n{{/if}}{{#each messages}}{{#ifUser}}<|im_start|>user\n{{content}}<|im_end|>\n<|im_start|>assistant\n{{/ifUser}}{{#ifAssistant}}{{content}}<|im_end|>\n{{/ifAssistant}}{{/each}}",
			m
		);
	}

	try {
		tokenizer = await getTokenizer(m.tokenizer);
	} catch (e) {
		console.error(
			"Failed to load tokenizer for model " +
				m.name +
				" consider setting chatPromptTemplate manually or making sure the model is available on the hub. Error: " +
				(e as Error).message
		);
		process.exit();
	}

	const renderTemplate = ({ messages, preprompt }: ChatTemplateInput) => {
		let formattedMessages: { role: string; content: string }[] = messages.map((message) => ({
			content: message.content,
			role: message.from,
		}));

		if (preprompt) {
			formattedMessages = [
				{
					role: "system",
					content: preprompt,
				},
				...formattedMessages,
			];
		}

		const output = tokenizer.apply_chat_template(formattedMessages, {
			tokenize: false,
			add_generation_prompt: true,
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
				url: `${HF_API_ROOT}/${m.name}`,
				accessToken: HF_TOKEN ?? HF_ACCESS_TOKEN,
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
					case "anthropic":
						return endpoints.anthropic(args);
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

export const models = await Promise.all(modelsRaw.map((e) => processModel(e).then(addEndpoint)));

export const defaultModel = models[0];

// Models that have been deprecated
export const oldModels = OLD_MODELS
	? z
			.array(
				z.object({
					id: z.string().optional(),
					name: z.string().min(1),
					displayName: z.string().min(1).optional(),
				})
			)
			.parse(JSON5.parse(OLD_MODELS))
			.map((m) => ({ ...m, id: m.id || m.name, displayName: m.displayName || m.name }))
	: [];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export const smallModel = TASK_MODEL
	? (models.find((m) => m.name === TASK_MODEL) ||
			(await processModel(modelConfig.parse(JSON5.parse(TASK_MODEL))).then((m) =>
				addEndpoint(m)
			))) ??
	  defaultModel
	: defaultModel;

export type BackendModel = Optional<
	typeof defaultModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted"
>;
