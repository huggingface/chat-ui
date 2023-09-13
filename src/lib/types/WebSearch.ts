import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface WebSearchSource {
	title: string;
	link: string;
	hostname: string;
}

export interface WebSearch extends Timestamps {
	_id: ObjectId;

	convId: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: WebSearchSource[];
	context: string;
	contextSources: WebSearchSource[];

	messages: WebSearchMessage[];
}

export type WebSearchMessageUpdate = {
	type: "update";
	message: string;
	args?: string[];
};

export type WebSearchMessageError = {
	type: "error";
	message: string;
	args?: string[];
};

export type WebSearchMessageResult = {
	type: "result";
	id: string;
};

export type WebSearchMessageSources = {
	type: "sources";
	sources: WebSearchSource[];
};

export type WebSearchMessage =
	| WebSearchMessageUpdate
	| WebSearchMessageResult
	| WebSearchMessageError
	| WebSearchMessageSources;
