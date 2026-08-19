import { writable } from "svelte/store";

/**
 * Set to the id of a durable prompt the user has just answered. The conversation page
 * picks it up and starts the run that continues the parked tool call — the form is nested
 * too deeply to hand it a callback, and nothing else needs to know.
 */
export const elicitationToResume = writable<string | null>(null);
