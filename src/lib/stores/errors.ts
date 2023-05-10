import { writable } from "svelte/store";

export const ERROR_MESSAGES = {
	default: "Oops, something went wrong.",
	authOnly: "You have to be logged in.",
};

export const error = writable<string | null>(null);
