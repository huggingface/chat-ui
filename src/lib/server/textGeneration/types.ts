import type { WebSearch, WebSearchSource } from "$lib/types/WebSearch";
import type { Tool, ToolCall, ToolResult } from "$lib/types/Tool";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { Assistant } from "$lib/types/Assistant";
import type { ProcessedModel } from "../models";
import type { Endpoint } from "../endpoints/endpoints";

export interface TextGenerationContext {
	model: ProcessedModel;
	endpoint: Endpoint;
	conv: Conversation;
	messages: Message[];
	assistant?: Pick<Assistant, "rag" | "dynamicPrompt" | "generateSettings">;
	isContinue: boolean;
	webSearch: boolean;
	toolsPreference: Record<string, boolean>;
	promptedAt: Date;
}

//----------
// Text Generation Updates

export type TextGenerationUpdate =
	| TextGenerationStatusUpdate
	| TextGenerationTitleUpdate
	| TextGenerationToolUpdate
	| TextGenerationWebSearchUpdate
	| TextGenerationStreamUpdate
	| TextGenerationFileUpdate
	| TextGenerationFinalAnswerUpdate;

export enum TextGenerationUpdateType {
	Status = "status",
	Title = "title",
	Tool = "tool",
	WebSearch = "webSearch",
	Stream = "stream",
	File = "file",
	FinalAnswer = "finalAnswer",
}

// Status
export enum TextGenerationStatus {
	Started = "started",
	Error = "error",
	Finished = "finished",
}
interface TextGenerationStatusUpdate {
	type: TextGenerationUpdateType.Status;
	status: TextGenerationStatus;
	message?: string;
}

// Web search
export enum TextGenerationWebSearchUpdateType {
	Update = "update",
	Error = "error",
	Sources = "sources",
	FinalAnswer = "finalAnswer",
}
export interface TextGenerationWebSearchErrorUpdate {
	type: TextGenerationUpdateType.WebSearch;
	subtype: TextGenerationWebSearchUpdateType.Error;
	message: string;
	args?: string[];
}
export interface TextGenerationWebSearchGeneralUpdate {
	type: TextGenerationUpdateType.WebSearch;
	subtype: TextGenerationWebSearchUpdateType.Update;
	message: string;
	args?: string[];
}
export interface TextGenerationWebSearchSourcesUpdate {
	type: TextGenerationUpdateType.WebSearch;
	subtype: TextGenerationWebSearchUpdateType.Sources;
	message: string;
	sources: WebSearchSource[];
}
export interface TextGenerationWebSearchFinalAnswerUpdate {
	type: TextGenerationUpdateType.WebSearch;
	subtype: TextGenerationWebSearchUpdateType.FinalAnswer;
	webSearch: WebSearch;
}
export type TextGenerationWebSearchUpdate =
	| TextGenerationWebSearchErrorUpdate
	| TextGenerationWebSearchGeneralUpdate
	| TextGenerationWebSearchSourcesUpdate
	| TextGenerationWebSearchFinalAnswerUpdate;

// Tool
export enum TextGenerationToolUpdateType {
	/** A request to call a tool alongside it's parameters */
	Call = "call",
	/** The result of a tool call */
	Result = "result",
}
interface TextGenerationToolBaseUpdate<TSubType extends TextGenerationToolUpdateType> {
	type: TextGenerationUpdateType.Tool;
	subtype: TSubType;
	uuid: string;
}
interface TextGenerationToolCallUpdate
	extends TextGenerationToolBaseUpdate<TextGenerationToolUpdateType.Call> {
	toolCall: ToolCall;
}
interface TextGenerationToolCallResultUpdate
	extends TextGenerationToolBaseUpdate<TextGenerationToolUpdateType.Result> {
	toolResult: ToolResult;
}
type TextGenerationToolUpdate = TextGenerationToolCallUpdate | TextGenerationToolCallResultUpdate;

// Everything else
interface TextGenerationTitleUpdate {
	type: TextGenerationUpdateType.Title;
	title: string;
}
interface TextGenerationStreamUpdate {
	type: TextGenerationUpdateType.Stream;
	token: string;
}
interface TextGenerationFileUpdate {
	type: TextGenerationUpdateType.File;
	sha: string;
}
interface TextGenerationFinalAnswerUpdate {
	type: TextGenerationUpdateType.FinalAnswer;
	text: string;
	interrupted: boolean;
}
