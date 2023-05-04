import { HF_ACCESS_TOKEN, MODELS } from "$env/static/private";
import type { Model } from "$lib/types/Model";
import { z } from "zod";

export const models = z
	.array(
		z.union([
			z.string().min(1),
			z.object({
				name: z.string().min(1),
				displayName: z.string().min(1).optional(),
				websiteUrl: z.string().url().optional(),
				datasetUrl: z.string().url().optional(),
				modelUrl: z.string().url().optional(),
				endpoints: z
					.array(
						z.object({
							url: z.string().url(),
							authorization: z.string().min(1).default(`Bearer ${HF_ACCESS_TOKEN}`),
							weight: z.number().int().positive().default(1),
						})
					)
					.optional(),
			}),
		])
	)
	.parse(JSON.parse(MODELS));

// TODO: Once we have all the model data in there, rename this so it's not confusing with only the model name string
export const modelsPublicData: Model[] = models.map((m) =>
	typeof m === "string"
		? { name: m, displayName: m }
		: { ...m, displayName: m.displayName ?? m.name, endpoints: undefined }
);
export const defaultModel = modelsPublicData[0];

export const getCurrentModel = (name?: string) =>
	modelsPublicData.find((m) => m.name === name) ?? defaultModel;
