import { HF_ACCESS_TOKEN, HF_API_ROOT, MODELS, OLD_MODELS, TASK_MODEL } from "$env/static/private";
import type { ChatTemplateInput } from "$lib/types/Template";
import { compileTemplate } from "$lib/utils/template";
import { z } from "zod";
import endpoints, { endpointSchema, type Endpoint } from "./endpoints/endpoints";
import endpointTgi from "./endpoints/tgi/endpointTgi";
import { sum } from "$lib/utils/sum";

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

const modelConfig = z.object({
	/** Used as an identifier in DB */
	id: z.string().optional(),
	/** Used to link to the model page, and for inference */
	name: z.string().min(1),
	displayName: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	websiteUrl: z.string().url().optional(),
	modelUrl: z.string().url().optional(),
	datasetName: z.string().min(1).optional(),
	datasetUrl: z.string().url().optional(),
	userMessageToken: z.string().default(""),
	userMessageEndToken: z.string().default(""),
	assistantMessageToken: z.string().default(""),
	assistantMessageEndToken: z.string().default(""),
	messageEndToken: z.string().default(""),
	preprompt: z.string().default(""),
	prepromptUrl: z.string().url().optional(),
	chatPromptTemplate: z
		.string()
		.default(
			"{{preprompt}}" +
				"{{#each messages}}" +
				"{{#ifUser}}{{@root.userMessageToken}}{{content}}{{@root.userMessageEndToken}}{{/ifUser}}" +
				"{{#ifAssistant}}{{@root.assistantMessageToken}}{{content}}{{@root.assistantMessageEndToken}}{{/ifAssistant}}" +
				"{{/each}}" +
				"{{assistantMessageToken}}"
		),
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
			temperature: z.number().min(0).max(1),
			truncate: z.number().int().positive(),
			max_new_tokens: z.number().int().positive(),
			stop: z.array(z.string()).optional(),
			top_p: z.number().positive().optional(),
			top_k: z.number().positive().optional(),
			repetition_penalty: z.number().min(-2).max(2).optional(),
		})
		.passthrough()
		.optional(),
	multimodal: z.boolean().default(false),
});

const modelsRaw = z.array(modelConfig).parse(JSON.parse(MODELS));

const processModel = async (m: z.infer<typeof modelConfig>) => ({
	...m,
	userMessageEndToken: m?.userMessageEndToken || m?.messageEndToken,
	assistantMessageEndToken: m?.assistantMessageEndToken || m?.messageEndToken,
	chatPromptRender: compileTemplate<ChatTemplateInput>(m.chatPromptTemplate, m),
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
				accessToken: HF_ACCESS_TOKEN,
				weight: 1,
				model: m,
			});
		}
		const totalWeight = sum(m.endpoints.map((e) => e.weight));

		let random = Math.random() * totalWeight;

		for (const endpoint of m.endpoints) {
			if (random < endpoint.weight) {
				const args = { ...endpoint, model: m };
				if (args.type === "tgi") {
					return endpoints.tgi(args);
				} else if (args.type === "aws") {
					return await endpoints.aws(args);
				} else if (args.type === "openai") {
					return await endpoints.openai(args);
				} else if (args.type === "llamacpp") {
					return await endpoints.llamacpp(args);
				} else {
					// for legacy reason
					return await endpoints.tgi(args);
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
			.parse(JSON.parse(OLD_MODELS))
			.map((m) => ({ ...m, id: m.id || m.name, displayName: m.displayName || m.name }))
	: [];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is the name of a model we use it, else we try to parse `TASK_MODEL` as a model config itself

export const smallModel = TASK_MODEL
	? (models.find((m) => m.name === TASK_MODEL) ||
			(await processModel(modelConfig.parse(JSON.parse(TASK_MODEL))).then((m) =>
				addEndpoint(m)
			))) ??
	  defaultModel
	: defaultModel;

export type BackendModel = Optional<typeof defaultModel, "preprompt" | "parameters" | "multimodal">;
