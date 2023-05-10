import type { Model } from "$lib/types/Model";

export const findCurrentModel = (models: Model[], id?: string) =>
	models.find((m) => m.id === id) ?? models[0];

export const isDisabledModel = (models: Model[], model: Model) => {
	return !models.includes(model);
};
