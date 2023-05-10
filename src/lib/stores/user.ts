import { writable } from "svelte/store";

export const user = writable<{ id: string | undefined; sessionId: string } | null>(null);
