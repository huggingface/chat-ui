import { writable } from "svelte/store";

export type BackgroundGeneration = {
	id: string;
	startedAt: number;
};

function createBackgroundGenerationStore() {
	const { subscribe, update, set } = writable<BackgroundGeneration[]>([]);

	return {
		subscribe,
		add(entry: BackgroundGeneration) {
			update((items) => {
				const exists = items.some((item) => item.id === entry.id);
				if (exists) {
					return items.map((item) => (item.id === entry.id ? entry : item));
				}
				return [...items, entry];
			});
		},
		remove(id: string) {
			update((items) => items.filter((item) => item.id !== id));
		},
		clear() {
			set([]);
		},
	};
}

export const backgroundGenerations = createBackgroundGenerationStore();
