import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";
import { parseWeb } from "../server/websearch/parseWeb";
import { parseArchyve } from "../server/websearch/parseArchyve";
import { format } from "date-fns";

export interface WebSearch extends Timestamps {
	_id?: ObjectId;
	convId?: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: WebSearchSource[];
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
		webSearchContext: string,
		lastQuestion: string,
		previousQuestions: string[]
	) => string;
	urlParser: (url: string) => Promise<string>;
	generateQuery: boolean;
	doSimilaritySearch: boolean;
}

export type WebSearchProviders = Record<string, WebSearchProvider>;
function defaultTemplator(
	webSearch: WebSearch,
	webSearchContext: string,
	lastQuestion: string,
	previousQuestions: string[]
): string {
	return `I searched the web using the query: ${webSearch.searchQuery}. 
Today is ${format(new Date(), "MMMM d, yyyy")} and here are the results:
=====================
${webSearchContext}
=====================
${previousQuestions.length > 0 ? `Previous questions: \n- ${previousQuestions.join("\n- ")}` : ""}
Answer the question: ${lastQuestion}`;
}

function archyveTemplator(
	webSearch: WebSearch,
	webSearchContext: string,
	lastQuestion: string,
	previousQuestions: string[]
): string {
	return `Given this context and previous questions, answer the following question:

${webSearchContext}

${previousQuestions.length > 0 ? `Previous questions: \n- ${previousQuestions.join("\n- ")}` : ""}

Question: ${lastQuestion}
`;
}

export const webSearchProviders: WebSearchProviders = {
	GOOGLE: {
		name: "Google",
		messageTemplator: defaultTemplator,
		urlParser: parseWeb,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	YOU: {
		name: "You.com",
		messageTemplator: defaultTemplator,
		urlParser: parseWeb,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	SEARXNG: {
		name: "SearXNG",
		messageTemplator: defaultTemplator,
		urlParser: parseWeb,
		generateQuery: true,
		doSimilaritySearch: true,
	},
	ARCHYVE: {
		name: "Archyve",
		messageTemplator: archyveTemplator,
		urlParser: parseArchyve,
		generateQuery: false,
		doSimilaritySearch: false,
	},
};
