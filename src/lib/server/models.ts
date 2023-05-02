import { HF_ACCESS_TOKEN, MODELS } from "$env/static/private";
import { z } from "zod";

export const models = z
	.array(
		z.union([
			z.string().min(1),
			z.object({
				name: z.string().min(1),
				endpoints: z.array(
					z.object({
						url: z.string().url(),
						authorization: z.string().min(1).default(`Bearer ${HF_ACCESS_TOKEN}`),
						weight: z.number().int().positive().default(1),
					})
				),
			}),
		])
	)
	.parse(JSON.parse(MODELS));

export const modelNames = models.map((m) => (typeof m === "string" ? m : m.name));
export const defaultModel = modelNames[0];
