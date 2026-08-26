import type { ObjectId } from "mongodb";
import type { OpenAiTool } from "$lib/server/mcp/tools";
import type { MessageUpdate } from "$lib/types/MessageUpdate";
import type { ElicitationSink } from "$lib/server/mcp/elicitation";

export type BuiltinToolResult =
	/** The call finished; `resultText` becomes the tool message the model reads next round. */
	| { resultText: string; extraUpdates?: MessageUpdate[] }
	/** Model-readable failure; surfaces as a tool error the model can retry on. */
	| { error: string }
	/**
	 * The call parked on user input; the run ends ("awaiting_input") and a later
	 * request resumes it. At most one call may park per round — the round's
	 * summary carries a single flag and the pending record is a scalar, so a
	 * second parked call would be silently lost and its unanswered tool call
	 * rejected by the provider on the next turn.
	 */
	| { awaitingInput: true };

export interface BuiltinToolContext {
	/** uuid of this call's Tool updates, shared with any extraUpdates that reference it. */
	uuid: string;
	/** The conversation this call belongs to. Absent only where the run has no chat context. */
	conversationId?: ObjectId;
	/**
	 * Who the turn belongs to. A tool that parks has to record this: the resume
	 * happens with no request to read an identity from, and must act as the user
	 * who parked rather than as whatever swept it.
	 */
	userId?: ObjectId;
	sessionId?: string;
	/** Provider-issued tool_call id. */
	toolCallId: string;
	/**
	 * The assistant message this run writes into. On a resumed parked call this
	 * is the recorded (parked) message id, never the client's current last one.
	 */
	messageId?: string;
	generationId?: string;
	/** Absent when there is no chat to prompt (no elicitation context for the run). */
	elicitationSink?: ElicitationSink;
	/**
	 * Cancelled when the user aborts the generation. Only matters to a builtin that
	 * does I/O — the first two parked or wrote and returned — but without it a tool
	 * making a 30s network call keeps going long after its result is discarded.
	 */
	abortSignal?: AbortSignal;
}

/**
 * A tool executed in-process instead of on an MCP server. Definitions are
 * static and hand-written — they never go through listing, caching or JSON
 * Schema sanitizing — and dispatch happens before the MCP mapping lookup.
 */
export interface BuiltinTool {
	name: string;
	definition: OpenAiTool;
	/** Static guidance appended to the tool preprompt while the tool is offered. */
	preprompt?: string;
	/** Whether the blanket "do not use a tool" restraint should name this tool as exempt. */
	exemptFromToolRestraint?: boolean;
	/** Whether execute may return `{awaitingInput: true}`. See BuiltinToolResult. */
	mayPark?: boolean;
	/** Refusal sent for a second parking-capable call in the same round. */
	parkRefusalMessage?: string;
	execute(args: Record<string, unknown>, ctx: BuiltinToolContext): Promise<BuiltinToolResult>;
}
