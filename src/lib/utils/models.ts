import type { Model } from "$lib/types/Model";

export const findCurrentModel = (
	models: Model[],
	_oldModels: { id: string; transferTo?: string }[] = [],
	id?: string
): Model => {
	if (id) {
		const direct = models.find((m) => m.id === id);
		if (direct) return direct;
	}

	return models[0];
};

/** Keep the first entry when an upstream model list repeats an id. */
export const dedupeModelsById = <T extends { id: string }>(models: T[]): T[] => {
	const seen = new Set<string>();
	return models.filter((model) => {
		if (seen.has(model.id)) return false;
		seen.add(model.id);
		return true;
	});
};
