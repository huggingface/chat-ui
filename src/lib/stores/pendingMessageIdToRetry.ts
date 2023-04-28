import type { Message } from "$lib/types/Message";
import { writable } from "svelte/store";

export const pendingMessageIdToRetry = writable<Message["id"] | null>(null);
