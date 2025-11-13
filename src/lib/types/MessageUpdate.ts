import type { InferenceProvider } from "@huggingface/inference";

export type MessageUpdate =
	| MessageStatusUpdate
	| MessageTitleUpdate
	| MessageStreamUpdate
	| MessageFileUpdate
	| MessageFinalAnswerUpdate
	| MessageReasoningUpdate
	| MessageRouterMetadataUpdate
	| MessageDebugUpdate;

export enum MessageUpdateType {
	Status = "status",
	Title = "title",
	Stream = "stream",
	File = "file",
	FinalAnswer = "finalAnswer",
	Reasoning = "reasoning",
	RouterMetadata = "routerMetadata",
	Debug = "debug",
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
	statusCode?: number;
}

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
}
export interface MessageRouterMetadataUpdate {
	type: MessageUpdateType.RouterMetadata;
	route: string;
	model: string;
	provider?: InferenceProvider;
}

export interface MessageDebugUpdate {
	type: MessageUpdateType.Debug;
	originalRequest?: {
		model?: string;
		messages?: unknown[];
		[key: string]: unknown;
	};
	securityResponse?: {
		action: "allow" | "block" | "modify";
		reason?: string;
		modifiedKwargs?: Record<string, unknown>;
	};
	securityResponseTime?: number;
	llmRequest?: {
		model?: string;
		messages?: unknown[];
		stream?: boolean;
		_stream_overridden?: boolean;
		[key: string]: unknown;
	};
	finalLlmResponse?: {
		id?: string;
		choices?: unknown[];
		model?: string;
		usage?: unknown;
		[key: string]: unknown;
	};
	llmResponseTime?: number;
	totalTime?: number;
	error?: string;
}
