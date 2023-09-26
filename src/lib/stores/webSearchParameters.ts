import { writable } from "svelte/store";
export interface WebSearchParameters {
	useSearch: boolean;
	useSDXL: boolean;
	nItems: number;
}
export const webSearchParameters = writable<WebSearchParameters>({
	useSearch: false,
	useSDXL: false,
	nItems: 5,
});
