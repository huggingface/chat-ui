import type { Message } from "./Message";

export type LegacyParamatersTemplateInput = {
	preprompt?: string;
	userMessageToken: string;
	userMessageEndToken: string;
	assistantMessageToken: string;
	assistantMessageEndToken: string;
};

export type ChatTemplateInput = {
	messages: Pick<Message, "from" | "content">[];
	preprompt?: string;
};

export type WebSearchSummaryTemplateInput = {
	answer: string;
	query: string;
};

export type WebSearchQueryTemplateInput = {
	messages: Pick<Message, "from" | "content">[];
};
