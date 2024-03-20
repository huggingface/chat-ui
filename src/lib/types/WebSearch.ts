import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";
import { format } from "date-fns";

export interface WebSearch extends Timestamps {
	_id?: ObjectId;
	convId?: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: WebSearchSource[];
	context: string;
	contextSources: WebSearchUsedSource[];
	provider: WebSearchProvider;
}

export interface WebSearchSource {
	title: string;
	link: string;
	hostname: string;
	text?: string; // You.com provides text of webpage right away
}

export interface WebSearchUsedSource extends WebSearchSource {
	context: { idx: number; text: string }[];
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

export interface WebSearchProvider {
	name: string;
	messageTemplator: (
		webSearch: WebSearch,
		lastQuestion: string,
		previousQuestions: string[]
	) => string;
	generateQuery: boolean;
	doSimilaritySearch: boolean;
}

export type WebSearchProviders = Record<string, WebSearchProvider>;

function defaultTemplator(
	webSearch: WebSearch,
	lastQuestion: string,
	previousQuestions: string[]
): string {
	return `I searched the web using the query: ${webSearch.searchQuery}.
	Today is ${format(new Date(), "MMMM d, yyyy")} and here are the results:
	=====================
	${webSearch.context}
	=====================
	${previousQuestions.length > 0 ? `Previous questions: \n- ${previousQuestions.join("\n- ")}` : ""}
	Answer the question: ${lastQuestion}`;
}

function archyveTemplator(
	webSearch: WebSearch,
	lastQuestion: string,
	previousQuestions: string[]
): string {
	return `Given this context and previous questions, answer the following question:

${webSearch.context}

${previousQuestions.length > 0 ? `Previous questions: \n- ${previousQuestions.join("\n- ")}` : ""}

Question: ${lastQuestion}
`;
}

export const webSearchProviders: WebSearchProviders = {
	GOOGLE: {
		name: "Google",
		messageTemplator: defaultTemplator,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	YOU: {
		name: "You.com",
		messageTemplator: defaultTemplator,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	SEARXNG: {
		name: "SearXNG",
		messageTemplator: defaultTemplator,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	ARCHYVE: {
		name: "Archyve",
		messageTemplator: archyveTemplator,
		generateQuery: false,
		doSimilaritySearch: false,
	},
};
