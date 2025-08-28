import type { WebSearchSource } from "$lib/types/WebSearch";

export type MessageUpdate =
    | MessageStatusUpdate
    | MessageTitleUpdate
    | MessageWebSearchUpdate
    | MessageStreamUpdate
    | MessageFileUpdate
    | MessageFinalAnswerUpdate
    | MessageReasoningUpdate;

export enum MessageUpdateType {
    Status = "status",
    Title = "title",
    WebSearch = "webSearch",
    Stream = "stream",
    File = "file",
    FinalAnswer = "finalAnswer",
    Reasoning = "reasoning",
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

// Tools feature removed: no tool update types

// Everything else
export interface MessageTitleUpdate {
	type: MessageUpdateType.Title;
	title: string;
}
export interface MessageStreamUpdate {
	type: MessageUpdateType.Stream;
	token: string;
}

export enum MessageReasoningUpdateType {
	Stream = "stream",
	Status = "status",
}

export type MessageReasoningUpdate = MessageReasoningStreamUpdate | MessageReasoningStatusUpdate;

export interface MessageReasoningStreamUpdate {
	type: MessageUpdateType.Reasoning;
	subtype: MessageReasoningUpdateType.Stream;
	token: string;
}
export interface MessageReasoningStatusUpdate {
	type: MessageUpdateType.Reasoning;
	subtype: MessageReasoningUpdateType.Status;
	status: string;
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
