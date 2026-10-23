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
	/** the dataset or parquet column it reads, when not the name */
	column?: string;
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

/** so labels join back to the exact source row */
export interface ReviewRecordOrigin {
	/** row_idx in the split or counted across the files, absent for a line read at a random byte */
	row?: number;
	/** the file holding it and the row within that file */
	file?: string;
	fileRow?: number;
	/** where the line starts in a jsonl or csv file */
	byte?: number;
}

export interface ReviewRecord {
	id: string;
	/** keyed by field name, which the declaration limits to safe Mongo keys */
	values: Record<string, unknown>;
	suggestions?: Record<string, ReviewSuggestion>;
	origin?: ReviewRecordOrigin;
	/** fields with no stored value, the media route serves them from the origin */
	media?: string[];
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

/** written by reviews submitted before the single submit, read by nothing */
export type ReviewVerdict = "approve" | "request_changes" | "comment";

export type ReviewSampleMethod = "head" | "random";

export interface ReviewSample {
	method: ReviewSampleMethod;
	rows: number;
	/** first row for head */
	offset?: number;
	/** random only, the same seed reads the same rows */
	seed?: number;
	/** how many contiguous windows a random sample was read in */
	windows?: number;
	/** a random parquet sample drawn inside this many row groups */
	groups?: number;
	/** jsonl or csv lines picked at byte offsets, biased toward long lines */
	approximate?: true;
	/** a viewer filter or full text search the rows were drawn from */
	where?: string;
	query?: string;
	/** rows drawn from after any where or query, unknown for jsonl or csv */
	total?: number;
	/** the size of the jsonl or csv files read */
	bytes?: number;
}

/** the viewer first, the hub files when it is unavailable */
export type ReviewDatasetVia = "viewer" | "parquet" | "converted" | "jsonl" | "csv" | "tsv";

export type ReviewSource =
	| { kind: "inline" }
	| { kind: "file"; name: string; version: number }
	| { kind: "sandbox"; handle: string; path: string }
	| { kind: "hub"; uri: string }
	| {
			kind: "dataset";
			repo: string;
			config: string;
			split: string;
			/** the commit or branch read, refs/convert/parquet for the viewer conversion */
			revision?: string;
			via: ReviewDatasetVia;
			files?: string[];
			/** the conversion covers only the first part of a large split */
			partial?: true;
			/** why the viewer was not used when a file read stood in */
			viewerError?: string;
			sample: ReviewSample;
	  }
	| {
			kind: "parquet";
			/** an hf uri of a dataset or bucket file or folder */
			uri: string;
			files: string[];
			revision?: string;
			sample: ReviewSample;
	  };

export type ReviewDestinationType = "dataset" | "bucket";

/** where the reviewed rows and labels are written, the publish card confirms it */
export interface ReviewDestination {
	repo: string;
	type: ReviewDestinationType;
	path: string;
	/** a pull request instead of a commit to main, forced when the user cannot write */
	pr: boolean;
}

/** who would see the pushed labels, shown on the publish card and the finish step */
export interface PublishAudience {
	label: string;
	exists: boolean;
	private?: boolean;
	/** false offers only a pull request or no push */
	canWrite: boolean;
}

/** unknown is treated as private: the card defaults to no push when it would go public */
export interface SourceAudience {
	visibility: "public" | "private" | "gated" | "unknown";
	label: string;
}

export type PublishDecision = "push" | "pr" | "skip";

/** the publish card the resumed turn parks on, and what the user chose there */
export interface ReviewPublish {
	audience?: PublishAudience;
	/** who could already see the reviewed rows, looked up when the review was requested */
	source?: SourceAudience;
	promptId?: string;
	decision?: PublishDecision;
	/** why nothing was pushed, said in the tool result */
	reason?: string;
	/** a detached card written onto its message, which waits for no turn to be saving it */
	attached?: true;
	decidedAt?: Date;
}

export interface ReviewPush {
	status: "pushing" | "pushed" | "failed";
	takenAt: Date;
	/** the path written, moved aside when the asked one is taken */
	path?: string;
	/** the commit, the pull request or the bucket file */
	url?: string;
	commit?: string;
	pr?: boolean;
	error?: string;
	finishedAt?: Date;
}

/** a submission the turn had moved past, posted by the server as the user's next message */
export interface ReviewDelivery {
	/** held waits for the publish card, the sweep only takes pending */
	status: "held" | "pending" | "sending" | "sent" | "failed";
	attempts: number;
	takenAt?: Date;
	/** a rate limited attempt waits until then */
	notBefore?: Date;
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
	/** the user's free text with the submission */
	note?: string;
	/** what older submissions stored as their note */
	summary?: string;
	/** built after the claim, so a losing submit never writes a responses file */
	result?: {
		text: string;
		files: MlFileRef[];
		/** the commit, pull request or bucket file the labels went to */
		pushed?: { url: string; pr: boolean; path: string };
		/** kept on the result so a resolved card can still say the push failed */
		pushFailed?: { error: string };
	};
	/** claimed while the parked call still waited, cleared once its row is answered or closed */
	unresolved?: true;
	/** recovery of an unresolved submission that threw, retried with backoff until it gives up */
	submitFailure?: { attempts: number; error: string; retryAt?: Date; gaveUp?: true };
	delivery?: ReviewDelivery;
	destination?: ReviewDestination;
	/** the model destination the user chose not to push to, nothing was pushed */
	declinedDestination?: ReviewDestination;
	publish?: ReviewPublish;
	push?: ReviewPush;
	createdAt: Date;
	updatedAt: Date;
	submittedAt?: Date;
	detachedAt?: Date;
	expiredAt?: Date;
}
