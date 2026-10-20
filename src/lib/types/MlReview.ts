import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { MlFileRef } from "./MlFile";

export type ReviewFieldType =
	| "text"
	| "markdown"
	| "code"
	| "json"
	| "chat"
	| "image"
	| "audio"
	| "video"
	| "number"
	| "category";

interface ReviewFieldBase {
	name: string;
	title?: string;
}

export type ReviewField =
	| (ReviewFieldBase & { type: Exclude<ReviewFieldType, "code"> })
	| (ReviewFieldBase & { type: "code"; language?: string });

export interface ReviewOption {
	value: string;
	title?: string;
	description?: string;
}

interface ReviewQuestionBase {
	name: string;
	title?: string;
	description?: string;
	required: boolean;
	/** a field name, the question is about that field rather than the whole record */
	target?: string;
}

export type ReviewQuestion =
	| (ReviewQuestionBase & { type: "label"; options: ReviewOption[] })
	| (ReviewQuestionBase & {
			type: "multi_label";
			options: ReviewOption[];
			min?: number;
			max?: number;
	  })
	| (ReviewQuestionBase & { type: "rating"; min: number; max: number })
	| (ReviewQuestionBase & { type: "boolean" })
	| (ReviewQuestionBase & { type: "text"; maxLength: number });

export type ReviewQuestionType = ReviewQuestion["type"];

export type ReviewSuggestionsMode = "shown" | "after_answer" | "none";

export interface ReviewSchema {
	title: string;
	instructions?: string;
	idField: string;
	fields: ReviewField[];
	questions: ReviewQuestion[];
	suggestions: ReviewSuggestionsMode;
}

export type ReviewAnswer = string | string[] | number | boolean;

/** the model's own guess, kept apart from the human answer */
export interface ReviewSuggestion {
	value: ReviewAnswer;
	score?: number;
	rationale?: string;
}

export interface ReviewRecord {
	id: string;
	/** keyed by field name, which the declaration limits to safe Mongo keys */
	values: Record<string, unknown>;
	suggestions?: Record<string, ReviewSuggestion>;
}

export type ReviewDraftStatus = "pending" | "answered" | "skipped" | "discarded";

export interface ReviewQuote {
	exact: string;
	prefix: string;
	suffix: string;
}

/** fractions of the image or video frame, so the box survives any display size */
export interface ReviewArea {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** seconds into the audio or video, a moment when end is absent */
export interface ReviewTime {
	start: number;
	end?: number;
}

export interface ReviewComment {
	id: string;
	/** absent means the comment is on the whole record */
	field?: string;
	quote?: ReviewQuote;
	area?: ReviewArea;
	time?: ReviewTime;
	body: string;
	createdAt: Date;
}

export interface ReviewDraft {
	status: ReviewDraftStatus;
	answers: Record<string, ReviewAnswer>;
	comments: ReviewComment[];
	/** bumped by every save of this record, a save from an older copy is refused */
	revision?: number;
	updatedAt: Date;
}

export type ReviewVerdict = "approve" | "request_changes" | "comment";

export type ReviewSource =
	| { kind: "inline" }
	| { kind: "file"; name: string; version: number }
	| { kind: "sandbox"; handle: string; path: string }
	| { kind: "hub"; uri: string };

/** a submission the turn had moved past, posted by the server as the user's next message */
export interface ReviewDelivery {
	status: "pending" | "sending" | "sent" | "failed";
	attempts: number;
	takenAt?: Date;
	/** the run the current attempt asked for, sent only once it exists */
	generationId?: string;
	messageId?: string;
	error?: string;
}

export type ReviewStatus = "open" | "submitted" | "detached" | "expired";

export interface MlReview {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	messageId: Message["id"];
	toolCallId: string;
	toolUuid: string;
	elicitationId: string;
	schema: ReviewSchema;
	schemaHash: string;
	source: ReviewSource;
	records: ReviewRecord[];
	/** keyed by position, a model chosen id can hold dots or dollar signs that break $set */
	drafts: Record<string, ReviewDraft>;
	/** bumped by every draft save, a submit built from an older read must not land */
	draftRevision: number;
	status: ReviewStatus;
	verdict?: ReviewVerdict;
	summary?: string;
	/** built after the claim, so a losing submit never writes a responses file */
	result?: { text: string; files: MlFileRef[] };
	/** claimed while the parked call still waited, cleared once its row is answered or closed */
	unresolved?: true;
	delivery?: ReviewDelivery;
	createdAt: Date;
	updatedAt: Date;
	submittedAt?: Date;
	detachedAt?: Date;
	expiredAt?: Date;
}
