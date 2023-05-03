import { HF_ACCESS_TOKEN, MODELS } from "$env/static/private";
import { z } from "zod";

export const models = z
	.array(
		z.union([
			z.string().min(1),
			z.object({
				name: z.string().min(1),
				displayName: z.string().min(1).optional(),
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
export const modelNames: Array<{ name: string; displayName: string }> = models.map((m) =>
	typeof m === "string"
		? { name: m, displayName: m }
		: { name: m.name, displayName: m.displayName ?? m.name }
);
export const defaultModel = modelNames[0];
