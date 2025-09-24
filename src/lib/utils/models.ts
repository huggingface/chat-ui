import type { Model } from "$lib/types/Model";

export const findCurrentModel = (
	models: Model[],
	oldModels: { id: string; transferTo?: string }[] = [],
	id?: string
): Model => {
	if (id) {
		const direct = models.find((m) => m.id === id);
		if (direct) return direct;

		const legacy = oldModels.find((m) => m.id === id);
		if (legacy?.transferTo) {
			const mapped = models.find((m) => m.id === legacy.transferTo);
			if (mapped) return mapped;
		}
	}

	return models[0];
};
