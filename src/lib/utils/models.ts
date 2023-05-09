import type { Model } from "$lib/types/Model";
import { z } from "zod";

export const findCurrentModel = (models: Model[], name?: string) =>
	models.find((m) => m.id === name) ?? models[0];

export const validateModel = (models: Model[]) => {
	const activeModels = models.filter((m) => !m.disabled);
	// Zod enum function requires 2 parameters
	return z.enum([activeModels[0].id, ...activeModels.slice(1).map((m) => m.id)]);
};
