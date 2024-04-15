import type { Call, Tool } from "./Tool";
import type { WebSearchSource } from "./WebSearch";

export type FinalAnswer = {
	type: "finalAnswer";
	text: string;
};

export type TextStreamUpdate = {
	type: "stream";
	token: string;
};

interface ToolUpdateBase {
	type: "tool";
	name: Tool["name"];
}

interface ToolUpdateParams extends ToolUpdateBase {
	messageType: "parameters";
	parameters: Call["parameters"];
}

interface ToolUpdateMessage extends ToolUpdateBase {
	messageType: "message";
	message?: string;
}

export type ToolUpdate = ToolUpdateParams | ToolUpdateMessage;

export type WebSearchUpdate = {
	type: "webSearch";
	messageType: "update" | "error" | "sources";
	message: string;
	args?: string[];
	sources?: WebSearchSource[];
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

export type FileUpdate = {
	type: "file";
	sha: string;
};

export type MessageUpdate =
	| FinalAnswer
	| TextStreamUpdate
	| ToolUpdate
	| WebSearchUpdate
	| StatusUpdate
	| ErrorUpdate
	| FileUpdate;
