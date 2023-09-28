import type { File } from "./Message";
import type { WebSearchSource } from "./WebSearch";

export type FinalAnswer = {
	type: "finalAnswer";
	text: string;
};

export type TextStreamUpdate = {
	type: "stream";
	token: string;
};

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

export type FileUpdate = {
	type: "file";
	file: File;
};

export type ErrorUpdate = {
	type: "error";
	message: string;
};

export type MessageUpdate =
	| FinalAnswer
	| TextStreamUpdate
	| WebSearchUpdate
	| StatusUpdate
	| FileUpdate
	| ErrorUpdate;
