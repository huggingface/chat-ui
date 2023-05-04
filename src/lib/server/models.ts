import { HF_ACCESS_TOKEN, MODELS } from "$env/static/private";
import { z } from "zod";

const modelsRaw = z
	.array(
		z.object({
			name: z.string().min(1),
			displayName: z.string().min(1).optional(),
			websiteUrl: z.string().url().optional(),
			datasetName: z.string().min(1).optional(),
			userMessageToken: z.string().min(1),
			assistantMessageToken: z.string().min(1),
			preprompt: z.string().default(""),
			prepromptUrl: z.string().url().optional(),
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
				})
				.passthrough(),
		})
	)
	.parse(JSON.parse(MODELS));

export const models = await Promise.all(
	modelsRaw.map((m) => ({
		...m,
		displayName: m.displayName || m.name,
		preprompt: m.prepromptUrl ? fetch(m.prepromptUrl).then((r) => r.text()) : m.preprompt,
	}))
);

export type BackendModel = (typeof models)[0];

export const defaultModel = models[0];
