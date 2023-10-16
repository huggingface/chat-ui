import { writable } from "svelte/store";

export interface TitleUpdate {
	convId: string;
	title: string;
}

const queueStore = () => {
	const { set, update, subscribe } = writable<Array<TitleUpdate>>([]);

	return {
		clear: () => set([]),
		pop: (): TitleUpdate => {
			let val: TitleUpdate | null = null;

			update((queue) => {
				val = queue.pop() ?? null;
				return queue;
			});

			if (!val) {
				throw new Error("Queue is empty");
			}

			return val;
		},
		push: (title: TitleUpdate) => update((queue) => [...queue, title]),
		subscribe,
	};
};

export default queueStore();
