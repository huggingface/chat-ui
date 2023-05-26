import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

export interface WebSearch extends Timestamps {
	_id: ObjectId;

	convId: Conversation["_id"];

	prompt: string;

	searchQuery: string;
	results: string[];
	knowledgeGraph: string;
	summary: string;
}

type MessageStatus = "pending" | "success" | "failure";

export type WebSearchMessageUpdate = {
	type: "update";
	message: string;
	args?: string[];
	status: MessageStatus;
};

export type WebSearchMessageResult = {
	type: "result";
	id: string;
};

export type WebSearchMessage = WebSearchMessageUpdate | WebSearchMessageResult;
