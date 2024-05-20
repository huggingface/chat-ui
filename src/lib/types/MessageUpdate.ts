import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import type { ToolCall, ToolResult } from "$lib/types/Tool";

export type MessageUpdate =
	| MessageStatusUpdate
	| MessageTitleUpdate
	| MessageToolUpdate
	| MessageWebSearchUpdate
	| MessageStreamUpdate
	| MessageFileUpdate
	| MessageFinalAnswerUpdate;

export enum MessageUpdateType {
	Status = "status",
	Title = "title",
	Tool = "tool",
	WebSearch = "webSearch",
	Stream = "stream",
	File = "file",
	FinalAnswer = "finalAnswer",
}

// Status
export enum MessageUpdateStatus {
	Started = "started",
	Error = "error",
	Finished = "finished",
}
export interface MessageStatusUpdate {
	type: MessageUpdateType.Status;
	status: MessageUpdateStatus;
	message?: string;
}

// Web search
export enum MessageWebSearchUpdateType {
	Update = "update",
	Error = "error",
	Sources = "sources",
	Finished = "finished",
}
export interface MessageWebSearchErrorUpdate {
	type: MessageUpdateType.WebSearch;
	subtype: MessageWebSearchUpdateType.Error;
	message: string;
	args?: string[];
}
export interface MessageWebSearchGeneralUpdate {
	type: MessageUpdateType.WebSearch;
	subtype: MessageWebSearchUpdateType.Update;
	message: string;
	args?: string[];
}
export interface MessageWebSearchSourcesUpdate {
	type: MessageUpdateType.WebSearch;
	subtype: MessageWebSearchUpdateType.Sources;
	message: string;
	sources: WebSearchSource[];
}
export interface MessageWebSearchFinishedUpdate {
	type: MessageUpdateType.WebSearch;
	subtype: MessageWebSearchUpdateType.Finished;
	webSearch: WebSearch;
}
export type MessageWebSearchUpdate =
	| MessageWebSearchErrorUpdate
	| MessageWebSearchGeneralUpdate
	| MessageWebSearchSourcesUpdate
	| MessageWebSearchFinishedUpdate;

// Tool
export enum MessageToolUpdateType {
	/** A request to call a tool alongside it's parameters */
	Call = "call",
	/** The result of a tool call */
	Result = "result",
}
interface MessageToolBaseUpdate<TSubType extends MessageToolUpdateType> {
	type: MessageUpdateType.Tool;
	subtype: TSubType;
	uuid: string;
}
export interface MessageToolCallUpdate extends MessageToolBaseUpdate<MessageToolUpdateType.Call> {
	call: ToolCall;
}
export interface MessageToolResultUpdate
	extends MessageToolBaseUpdate<MessageToolUpdateType.Result> {
	result: ToolResult;
}
export type MessageToolUpdate = MessageToolCallUpdate | MessageToolResultUpdate;

// Everything else
export interface MessageTitleUpdate {
	type: MessageUpdateType.Title;
	title: string;
}
export interface MessageStreamUpdate {
	type: MessageUpdateType.Stream;
	token: string;
}
export interface MessageFileUpdate {
	type: MessageUpdateType.File;
	name: string;
	sha: string;
	mime: string;
}
export interface MessageFinalAnswerUpdate {
	type: MessageUpdateType.FinalAnswer;
	text: string;
	interrupted: boolean;
}
