import type { Model } from "$lib/types/Model";

export const findCurrentModel = (models: Model[], name?: string) =>
	models.find((m) => m.name === name) ?? models[0];
