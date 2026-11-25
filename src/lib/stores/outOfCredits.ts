import { writable } from "svelte/store";

/** the last turn hit an out of credits 402 and nothing has streamed since */
export const outOfCredits = writable(false);
