import type { Model } from "$lib/types/Model";

export const findCurrentModel = (models: Model[], id?: string): Model =>
	models.find((m) => m.id === id) ?? models[0];
