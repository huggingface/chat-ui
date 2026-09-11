import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";

/**
 * One tool call made inside a sub-agent (see nestedAgent.ts), for debugging.
 *
 * Deliberately not the generation event log: that replays to the client and
 * materializes into `messages.$.updates`.
 */
export interface NestedAgentCall {
	_id: ObjectId;
	conversationId?: Conversation["_id"];
	messageId?: Message["id"];
	generationId?: string;
	/** "sandbox", "research", "job-watcher". */
	label: string;
	iteration: number;
	toolName: string;
	/**
	 * Raw arguments as the model produced them, redacted and truncated. Not
	 * `ToolCall.parameters`, which drops non-primitives — a sandbox command
	 * arrives there as `{}`.
	 */
	arguments: string;
	/** Occurrences of this exact (tool, arguments) pair so far, including this one. */
	repeatCount: number;
	status: "success" | "error";
	error?: string;
	createdAt: Date;
}
