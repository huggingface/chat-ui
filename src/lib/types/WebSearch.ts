import type { RagContext } from "./rag";

export interface RagContextWebSearch extends RagContext {
	prompt: string;
	searchQuery: string;
	results: WebSearchSource[];
	contextSources: WebSearchSource[];
}

export interface WebSearchSource {
	title: string;
	link: string;
	hostname: string;
	text?: string; // You.com provides text of webpage right away
}

export type WebSearchMessageSources = {
	type: "sources";
	sources: WebSearchSource[];
};

export interface YouWebSearch {
	hits: YouSearchHit[];
	latency: number;
}

interface YouSearchHit {
	url: string;
	title: string;
	description: string;
	snippets: string[];
}

// eslint-disable-next-line no-shadow
export enum WebSearchProvider {
	GOOGLE = "Google",
	YOU = "You.com",
}
