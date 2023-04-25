import { writable } from "svelte/store";

export const error = writable<string | null>(null);
