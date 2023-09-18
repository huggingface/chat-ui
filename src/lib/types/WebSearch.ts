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
}

export type WebSearchMessageSources = {
	type: "sources";
	sources: WebSearchSource[];
};
