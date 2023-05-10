import type { Model } from "$lib/types/Model";
import { z } from "zod";

export const findCurrentModel = (models: Model[], id?: string) =>
	models.find((m) => m.id === id) ?? models[0];

export const validateModel = (models: Model[]) => {
	// Zod enum function requires 2 parameters
	return z.enum([models[0].id, ...models.slice(1).map((m) => m.id)]);
};
