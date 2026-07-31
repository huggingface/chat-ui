import type { InferenceProvider } from "@huggingface/inference";
import type { ToolCall, ToolResult } from "$lib/types/Tool";

export type MessageUpdate =
	| MessageStatusUpdate
	| MessageTitleUpdate
	| MessageToolUpdate
	| MessageStreamUpdate
	| MessageFileUpdate
	| MessageFinalAnswerUpdate
	| MessageReasoningUpdate
	| MessageRouterMetadataUpdate;

export enum MessageUpdateType {
	Status = "status",
	Title = "title",
	Tool = "tool",
	Stream = "stream",
	File = "file",
	FinalAnswer = "finalAnswer",
	Reasoning = "reasoning",
	RouterMetadata = "routerMetadata",
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
	/** Length of the original token. Used for compressed/persisted stream markers where token is empty. */
	len?: number;
}

// Tool updates (for MCP and function calling)
export enum MessageToolUpdateType {
	Call = "call",
	Result = "result",
	Error = "error",
	ETA = "eta",
	Progress = "progress",
}

interface MessageToolUpdateBase<TSubtype extends MessageToolUpdateType> {
	type: MessageUpdateType.Tool;
	subtype: TSubtype;
	uuid: string;
}

export interface MessageToolCallUpdate extends MessageToolUpdateBase<MessageToolUpdateType.Call> {
	call: ToolCall;
	/**
	 * Reasoning that led to this round of calls (set on the round's first call
	 * update). Lets history replay re-attach reasoning to the right assistant
	 * message; absent on messages persisted before this field existed.
	 */
	reasoning?: string;
	/**
	 * Visible text the model streamed before this round's tool calls (set on
	 * the round's first call update), e.g. "Let me check that." Lets history
	 * replay keep the preamble on its own round's assistant message instead of
	 * moving it after the tool results; absent on messages persisted before
	 * this field existed.
	 */
	content?: string;
	/**
	 * Original provider-issued tool_call id and raw JSON arguments string, as
	 * sent by the model (set on every Call update; argumentsRaw only when it
	 * validates as JSON — a malformed string is never persisted here, since
	 * replaying invalid JSON in a historical tool call could get the whole
	 * continuation rejected by providers that validate the field). Replay
	 * uses argumentsRaw when present for byte-accurate arguments instead of
	 * reserializing the sanitized primitive parameters; the emitted
	 * tool_call_id is always the
	 * normalized one regardless (see toToolCallId in prepareFiles.ts), so
	 * originalId is captured for future fidelity but not replayed as-is.
	 * Absent on messages persisted before this field existed, or if the
	 * provider's response omitted an id.
	 */
	originalId?: string;
	argumentsRaw?: string;
}

export interface MessageToolResultUpdate extends MessageToolUpdateBase<MessageToolUpdateType.Result> {
	result: ToolResult;
}

export interface MessageToolErrorUpdate extends MessageToolUpdateBase<MessageToolUpdateType.Error> {
	message: string;
}

export interface MessageToolEtaUpdate extends MessageToolUpdateBase<MessageToolUpdateType.ETA> {
	eta: number;
}

export interface MessageToolProgressUpdate extends MessageToolUpdateBase<MessageToolUpdateType.Progress> {
	progress: number;
	total?: number;
	message?: string;
}

export type MessageToolUpdate =
	| MessageToolCallUpdate
	| MessageToolResultUpdate
	| MessageToolErrorUpdate
	| MessageToolEtaUpdate
	| MessageToolProgressUpdate;

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
