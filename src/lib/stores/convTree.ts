import type { Message } from "$lib/types/Message";
import { getContext, setContext } from "svelte";
import { writable, type Writable } from "svelte/store";

// used to store the id of the message that is the currently displayed leaf of the conversation tree
// (that is the last message in the current branch of the conversation tree)

interface ConvTreeStore {
	leaf: Message["id"] | null;
	editing: Message["id"] | null;
}

export function useConvTreeStore() {
	return getContext<Writable<ConvTreeStore>>("convTreeStore");
}

export function createConvTreeStore() {
	const convTreeStore = writable<ConvTreeStore>({
		leaf: null,
		editing: null,
	});
	setContext("convTreeStore", convTreeStore);

	return convTreeStore;
}
