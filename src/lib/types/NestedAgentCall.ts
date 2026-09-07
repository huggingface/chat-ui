import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";

/**
 * One tool call made *inside* a sub-agent (see nestedAgent.ts), recorded for
 * debugging only.
 *
 * A sub-agent's Call/Result updates never reach the conversation — only its
 * summary does — so when a run hits the iteration cap there is nothing to say
 * where the iterations went. That gap is why the sandbox's cap could not be
 * judged too small or merely leaky: the rejections are invisible after the
 * fact, and a debug flag is always off on the run you wanted.
 *
 * Deliberately NOT the generation event log: that log replays to the client and
 * materializes into `messages.$.updates`, which would put sub-agent internals
 * in the UI — the thing the design avoids.
 *
 * Deliberately compact. `arguments` is a truncated prefix and outputs are not
 * stored at all: sandbox commands and their output carry live credentials (the
 * Hub redacts HF_TOKEN in its own job logs for this reason), and the question
 * this answers — which calls were rejected, and why — needs the error, not the
 * payload.
 */
export interface NestedAgentCall {
	_id: ObjectId;
	conversationId?: Conversation["_id"];
	messageId?: Message["id"];
	generationId?: string;
	/** The sub-agent that made the call: "sandbox", "research". */
	label: string;
	/** 0-based iteration of the sub-agent loop this call was made in. */
	iteration: number;
	toolName: string;
	/**
	 * Raw arguments as the model produced them, redacted and truncated. Never
	 * the tool's output.
	 *
	 * Taken from the call rather than from the emitted update: `ToolCall.
	 * parameters` drops every non-primitive value, so a sandbox command arrives
	 * there as `{}` — useless for telling two polls of one log file apart from
	 * two different commands.
	 */
	arguments: string;
	/**
	 * Occurrences of this exact (tool, arguments) pair so far in the run,
	 * including this one. 1 is a first call; a climbing count is the loop the
	 * repetition guard eventually fires on — and the shape that spends an
	 * iteration budget without ever failing.
	 */
	repeatCount: number;
	status: "success" | "error";
	/** Present when the call was rejected or failed. Truncated. */
	error?: string;
	createdAt: Date;
}
