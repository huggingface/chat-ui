import { writable } from "svelte/store";

export const isConversationShared = writable<boolean>(false);
