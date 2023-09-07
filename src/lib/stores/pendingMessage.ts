import { writable } from "svelte/store";

export const pendingMessage = writable<string>("");
