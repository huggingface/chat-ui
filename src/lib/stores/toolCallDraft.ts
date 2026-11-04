import { writable } from "svelte/store";
import type { ToolCallDraft } from "$lib/types/MessageUpdate";

/** The live turn's tool call while its arguments are still streaming; null otherwise. */
export const toolCallDraft = writable<ToolCallDraft | null>(null);
