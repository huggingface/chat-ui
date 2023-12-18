import type { WebSearchSource } from "./WebSearch";

export type FinalAnswer = {
	type: "finalAnswer";
	text: string;
};

export type TextStreamUpdate = {
	type: "stream";
	token: string;
};

export type AgentUpdate = {
	type: "agent";
	agent: string;
	content: string;
	binary?: Blob;
};

export type WebSearchUpdate = {
	type: "webSearch";
	messageType: "update" | "error" | "sources";
	message: string;
	args?: string[];
	sources?: WebSearchSource[];
};

export type PdfSearchUpdate = {
	type: "pdfSearch";
	messageType: "update" | "error" | "done";
	message: string;
	args?: string[];
};

export type RAGUpdate = WebSearchUpdate | PdfSearchUpdate;

export type StatusUpdate = {
	type: "status";
	status: "started" | "pending" | "finished" | "error" | "title";
	message?: string;
};

export type ErrorUpdate = {
	type: "error";
	message: string;
	name: string;
};

export type MessageUpdate =
	| FinalAnswer
	| TextStreamUpdate
	| AgentUpdate
	| WebSearchUpdate
	| PdfSearchUpdate
	| StatusUpdate
	| ErrorUpdate;
