import type { Message } from "$lib/types/Message";
import { getContext, setContext } from "svelte";
import { writable, type Writable } from "svelte/store";

// used to store the id of the message that is the currently displayed leaf of the conversation tree
// (that is the last message in the current branch of the conversation tree)

export function useLeafConversationTree() {
	return getContext<Writable<Message["id"]>>("leafConversationTree");
}

export function createLeafConversationTree() {
	const leafConversationTree = writable<Message["id"]>();
	setContext("leafConversationTree", leafConversationTree);

	return leafConversationTree;
}
