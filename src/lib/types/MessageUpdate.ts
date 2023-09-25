import type { WebSearchSource } from "./WebSearch";
import type { Update } from "@huggingface/agents/src/types";

export type FinalAnswer = {
	type: "finalAnswer";
	text: string;
};

export type TextStreamUpdate = {
	type: "stream";
	token: string;
};

export interface AgentUpdate extends Update {
	type: "agent";
}

export type WebSearchUpdate = {
	type: "webSearch";
	messageType: "update" | "error" | "sources";
	message: string;
	args?: string[];
	sources?: WebSearchSource[];
};

export type StatusUpdate = {
	type: "status";
	status: "started" | "pending" | "finished" | "error";
	message?: string;
};

export type MessageUpdate =
	| FinalAnswer
	| TextStreamUpdate
	| AgentUpdate
	| WebSearchUpdate
	| StatusUpdate;
