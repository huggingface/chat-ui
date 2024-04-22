import { writable } from "svelte/store";
export interface WebSearchParameters {
	useSearch: boolean;
	useTools: boolean;
	nItems: number;
}
export const webSearchParameters = writable<WebSearchParameters>({
	useSearch: false,
	useTools: true, // since the model will decide whether or not to use tools, it makes sense to default to true here
	nItems: 5,
});
