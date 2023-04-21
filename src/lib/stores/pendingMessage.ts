import { writable } from "svelte/store";

export const pendingMessage = writable<{ conversationId: string; message: string } | null>(null);
