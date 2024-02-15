import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface WebSearch extends Timestamps {
	_id?: ObjectId;
	convId?: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: WebSearchSource[];
	context: string;
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
	SEARXNG = "SearXNG",
}
