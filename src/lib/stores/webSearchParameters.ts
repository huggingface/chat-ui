import { writable } from "svelte/store";

export interface WebSearchParameters {
	useSearch: boolean;
	nItems: number;
}
export const webSearchParameters = writable<WebSearchParameters>({
	useSearch: true,
	nItems: 5,
});
