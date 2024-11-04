import type { WebSearchSource } from "$lib/types/WebSearch";
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
	KeepAlive = "keepAlive",
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
export interface BaseMessageWebSearchUpdate<TSubType extends MessageWebSearchUpdateType> {
	type: MessageUpdateType.WebSearch;
	subtype: TSubType;
}
export interface MessageWebSearchErrorUpdate
	extends BaseMessageWebSearchUpdate<MessageWebSearchUpdateType.Error> {
	message: string;
	args?: string[];
}
export interface MessageWebSearchGeneralUpdate
	extends BaseMessageWebSearchUpdate<MessageWebSearchUpdateType.Update> {
	message: string;
	args?: string[];
}
export interface MessageWebSearchSourcesUpdate
	extends BaseMessageWebSearchUpdate<MessageWebSearchUpdateType.Sources> {
	message: string;
	sources: WebSearchSource[];
}
export type MessageWebSearchFinishedUpdate =
	BaseMessageWebSearchUpdate<MessageWebSearchUpdateType.Finished>;
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
	/** Error while running tool */
	Error = "error",
	/** ETA update */
	ETA = "eta",
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
export interface MessageToolErrorUpdate extends MessageToolBaseUpdate<MessageToolUpdateType.Error> {
	message: string;
}

export interface MessageToolETAUpdate extends MessageToolBaseUpdate<MessageToolUpdateType.ETA> {
	eta: number;
}

export type MessageToolUpdate =
	| MessageToolCallUpdate
	| MessageToolResultUpdate
	| MessageToolErrorUpdate
	| MessageToolETAUpdate;

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
	webSources?: { uri: string; title: string }[];
}
