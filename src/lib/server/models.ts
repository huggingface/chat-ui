import { HF_ACCESS_TOKEN, MODELS, OLD_MODELS } from "$env/static/private";
import { z } from "zod";

const modelsRaw = z
	.array(
		z.object({
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
			userMessageToken: z.string().min(1),
			assistantMessageToken: z.string().min(1),
			messageEndToken: z.string().min(1).optional(),
			preprompt: z.string().default(""),
			prepromptUrl: z.string().url().optional(),
			promptExamples: z
				.array(
					z.object({
						title: z.string().min(1),
						prompt: z.string().min(1),
					})
				)
				.optional(),
			endpoints: z
				.array(
					z.object({
						url: z.string().url(),
						authorization: z.string().min(1).default(`Bearer ${HF_ACCESS_TOKEN}`),
						weight: z.number().int().positive().default(1),
					})
				)
				.optional(),
			parameters: z
				.object({
					temperature: z.number().min(0).max(1),
					truncate: z.number().int().positive(),
					max_new_tokens: z.number().int().positive(),
					stop: z.array(z.string()).optional(),
				})
				.passthrough()
				.optional(),
		})
	)
	.parse(JSON.parse(MODELS));

export const models = await Promise.all(
	modelsRaw.map(async (m) => ({
		...m,
		id: m.id || m.name,
		displayName: m.displayName || m.name,
		preprompt: m.prepromptUrl ? await fetch(m.prepromptUrl).then((r) => r.text()) : m.preprompt,
	}))
);

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

export type BackendModel = (typeof models)[0];

export const defaultModel = models[0];

export const validateModel = (_models: BackendModel[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([_models[0].id, ..._models.slice(1).map((m) => m.id)]);
};
