import { env } from "$env/dynamic/private";
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
import { ToolResultStatus, type ToolInput } from "$lib/types/Tool";

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
	tools: z.boolean().default(false),
	unlisted: z.boolean().default(false),
	embeddingModel: validateEmbeddingModelByName(embeddingModels).optional(),
});

const modelsRaw = z.array(modelConfig).parse(JSON5.parse(env.MODELS));

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
		logger.error(
			e,
			`Failed to load tokenizer for model ${m.name} consider setting chatPromptTemplate manually or making sure the model is available on the hub.`
		);
		process.exit();
	}

	const renderTemplate = ({ messages, preprompt, tools, toolResults }: ChatTemplateInput) => {
		let formattedMessages: { role: string; content: string }[] = messages.map((message) => ({
			content: message.content,
			role: message.from,
		}));

		if (preprompt && formattedMessages[0].role !== "system") {
			formattedMessages = [
				{
					role: "system",
					content: preprompt,
				},
				...formattedMessages,
			];
		}

		if (toolResults?.length) {
			// todo: should update the command r+ tokenizer to support system messages at any location
			// or use the `rag` mode without the citations
			const id = m.id ?? m.name;

			if (id.startsWith("CohereForAI")) {
				formattedMessages = [
					{
						role: "system",
						content:
							"\n\n<results>\n" +
							toolResults
								.flatMap((result, idx) => {
									if (result.status === ToolResultStatus.Error) {
										return (
											`Document: ${idx}\n` + `Tool "${result.call.name}" error\n` + result.message
										);
									}
									return (
										`Document: ${idx}\n` +
										result.outputs
											.flatMap((output) =>
												Object.entries(output).map(([title, text]) => `${title}\n${text}`)
											)
											.join("\n")
									);
								})
								.join("\n\n") +
							"\n</results>",
					},
					...formattedMessages,
				];
			} else if (id.startsWith("meta-llama")) {
				const results = toolResults.flatMap((result) => {
					if (result.status === ToolResultStatus.Error) {
						return [
							{
								tool_call_id: result.call.name,
								output: "Error: " + result.message,
							},
						];
					} else {
						return result.outputs.map((output) => ({
							tool_call_id: result.call.name,
							output: JSON.stringify(output),
						}));
					}
				});

				formattedMessages = [
					...formattedMessages,
					{
						role: "python",
						content: JSON.stringify(results),
					},
				];
			} else {
				formattedMessages = [
					...formattedMessages,
					{
						role: "system",
						content: JSON.stringify(toolResults),
					},
				];
			}
			tools = [];
		}

		const chatTemplate = tools?.length ? "tool_use" : undefined;

		const documents = (toolResults ?? []).flatMap((result) => {
			if (result.status === ToolResultStatus.Error) {
				return [{ title: `Tool "${result.call.name}" error`, text: "\n" + result.message }];
			}
			return result.outputs.flatMap((output) =>
				Object.entries(output).map(([title, text]) => ({
					title: `Tool "${result.call.name}" ${title}`,
					text: "\n" + text,
				}))
			);
		});

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
			add_generation_prompt: true,
			chat_template: chatTemplate,
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			tools: mappedTools,
			documents,
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

export type ProcessedModel = Awaited<ReturnType<typeof processModel>> & {
	getEndpoint: () => Promise<Endpoint>;
};

const addEndpoint = (m: Awaited<ReturnType<typeof processModel>>) => ({
	...m,
	getEndpoint: async (): Promise<Endpoint> => {
		if (!m.endpoints) {
			return endpointTgi({
				type: "tgi",
				url: `${env.HF_API_ROOT}/${m.name}`,
				accessToken: env.HF_TOKEN ?? env.HF_ACCESS_TOKEN,
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
					case "anthropic-vertex":
						return endpoints.anthropicvertex(args);
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

export const models: ProcessedModel[] = await Promise.all(
	modelsRaw.map((e) => processModel(e).then(addEndpoint))
);

export const defaultModel = models[0];

// Models that have been deprecated
export const oldModels = env.OLD_MODELS
	? z
			.array(
				z.object({
					id: z.string().optional(),
					name: z.string().min(1),
					displayName: z.string().min(1).optional(),
				})
			)
			.parse(JSON5.parse(env.OLD_MODELS))
			.map((m) => ({ ...m, id: m.id || m.name, displayName: m.displayName || m.name }))
	: [];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};

// if `TASK_MODEL` is string & name of a model in `MODELS`, then we use `MODELS[TASK_MODEL]`, else we try to parse `TASK_MODEL` as a model config itself

export const smallModel = env.TASK_MODEL
	? (models.find((m) => m.name === env.TASK_MODEL) ||
			(await processModel(modelConfig.parse(JSON5.parse(env.TASK_MODEL))).then((m) =>
				addEndpoint(m)
			))) ??
	  defaultModel
	: defaultModel;

export type BackendModel = Optional<
	typeof defaultModel,
	"preprompt" | "parameters" | "multimodal" | "unlisted" | "tools"
>;
