import type { WebSearchSource } from "./WebSearch";
import type { RAGType } from "./rag";

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

export interface RAGUpdate {
	type: RAGType;
	messageType: "update" | "error" | "done" | string;
	message: string;
	args?: string[];
};

export interface WebSearchUpdate extends RAGUpdate {
	type: "websearch",
	messageType: RAGUpdate["messageType"] | "sources";
	sources?: WebSearchSource[];
};

export interface PdfSearchUpdate extends RAGUpdate {
	type: "pdfChat";
};


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
	| RAGUpdate
	| StatusUpdate
	| ErrorUpdate;
