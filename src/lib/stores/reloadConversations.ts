import { writable } from "svelte/store";

export const reloadConversationsNotifier = writable(0);
export function triggerConversationsReload() {
	reloadConversationsNotifier.update((n) => n + 1);
}
