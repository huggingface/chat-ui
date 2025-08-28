import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";
// websearch removed; use any for markdown tree

export interface WebSearch extends Timestamps {
	_id?: ObjectId;
	convId?: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: WebSearchSource[];
	contextSources: WebSearchUsedSource[];
}

export interface WebSearchSource {
	title?: string;
	link: string;
}
export interface WebSearchScrapedSource extends WebSearchSource {
	page: WebSearchPage;
}
export interface WebSearchPage {
	title: string;
	siteName?: string;
	author?: string;
	description?: string;
	createdAt?: string;
	modifiedAt?: string;
	markdownTree: any;
}

export interface WebSearchUsedSource extends WebSearchScrapedSource {
	context: string;
}

export type WebSearchMessageSources = {
	type: "sources";
	sources: WebSearchSource[];
};

// eslint-disable-next-line no-shadow
export enum WebSearchProvider {
	GOOGLE = "Google",
	YOU = "You.com",
	SEARXNG = "SearXNG",
	BING = "Bing",
}
