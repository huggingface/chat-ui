import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

/**
 * A form field, normalized from MCP's `PrimitiveSchemaDefinition`. The spec spells the
 * same select box six ways (`enum`, `enum`+`enumNames`, `oneOf`, and array variants of
 * each); collapsing them here means the browser, the response validator and the UI all
 * read one shape, and a new spec spelling only has to be taught to the normalizer.
 */
export type ElicitationField =
	| {
			kind: "string";
			name: string;
			title?: string;
			description?: string;
			required: boolean;
			minLength?: number;
			maxLength?: number;
			format?: "email" | "uri" | "date" | "date-time";
			default?: string;
	  }
	| {
			kind: "number";
			name: string;
			title?: string;
			description?: string;
			required: boolean;
			integer: boolean;
			minimum?: number;
			maximum?: number;
			default?: number;
	  }
	| {
			kind: "boolean";
			name: string;
			title?: string;
			description?: string;
			required: boolean;
			default?: boolean;
	  }
	| {
			kind: "select";
			name: string;
			title?: string;
			description?: string;
			required: boolean;
			multiple: boolean;
			options: Array<{ value: string; label: string }>;
			minItems?: number;
			maxItems?: number;
			default?: string | string[];
	  };

export type ElicitationValue = string | number | boolean | string[];

export type ElicitationAction = "accept" | "decline" | "cancel";

/**
 * Why a pending elicitation stopped waiting without the user answering. Surfaced in the
 * transcript so a form that vanished is explained rather than just gone.
 *
 * `withdrawn` is the common one in practice: the server put its own timeout on the
 * request it sent us (60s by MCP SDK default) and gave up before the user got back.
 */
export type ElicitationResolution = "user" | "expired" | "aborted" | "withdrawn";

/**
 * The part of an elicitation that is safe to show and to replay: every string here came
 * from the MCP server, so it is untrusted display text and must never be rendered as
 * markup.
 */
export interface ElicitationRequestPayload {
	elicitationId: string;
	/** Name of the MCP server asking, so the user can see who wants the data. */
	server: string;
	mode: "form" | "url";
	message: string;
	/** Present in `form` mode. */
	fields?: ElicitationField[];
	/** Present in `url` mode. Always http(s) — other schemes are rejected on arrival. */
	url?: string;
}

/**
 * A pending request for user input, raised by an MCP server mid tool call.
 *
 * It lives in the database rather than in the process that is waiting because the pod
 * serving the user's answer need not be the pod running the generation — the same split
 * `abortedGenerations` exists for.
 */
export interface McpElicitation extends Timestamps {
	_id: ObjectId;
	elicitationId: string;
	conversationId: Conversation["_id"];
	/** The run that raised it; absent only if the run had no writer. */
	generationId?: string;
	status: "pending" | "resolved";
	request: ElicitationRequestPayload;
	action?: ElicitationAction;
	content?: Record<string, ElicitationValue>;
	/** After this instant the answer is refused and the waiter gives up. */
	expiresAt: Date;
	resolvedAt?: Date;
}
