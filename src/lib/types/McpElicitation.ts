import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";

/** Normalized from MCP's `PrimitiveSchemaDefinition`, which spells a select box six ways. */
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

/** `withdrawn` is the server giving up on its own request, which it usually does first. */
export type ElicitationResolution = "user" | "expired" | "aborted" | "withdrawn";

/** Every string here is server-authored, so it is display text and never markup. */
export interface ElicitationRequestPayload {
	elicitationId: string;
	server: string;
	mode: "form" | "url";
	message: string;
	fields?: ElicitationField[];
	url?: string;
}

/** In the database because the pod serving the answer need not be the one waiting on it. */
export interface McpElicitation extends Timestamps {
	_id: ObjectId;
	elicitationId: string;
	conversationId: Conversation["_id"];
	generationId?: string;
	status: "pending" | "resolved";
	request: ElicitationRequestPayload;
	action?: ElicitationAction;
	content?: Record<string, ElicitationValue>;
	/** Absent for a 2026-era prompt: nothing is waiting, so nothing expires. */
	expiresAt?: Date;
	resolvedAt?: Date;
	/**
	 * Everything needed to re-issue the tool call once answered. Present only for a
	 * 2026-era prompt, where the server kept no state and any process can continue it.
	 */
	pending?: {
		server: string;
		tool: string;
		args: Record<string, unknown>;
		/** Opaque; echoed back byte-exact. */
		requestState?: string;
		/** Which key in the server's `inputRequests` this form answers. */
		inputKey: string;
		messageId: string;
		toolCallId: string;
		toolUuid: string;
	};
}
