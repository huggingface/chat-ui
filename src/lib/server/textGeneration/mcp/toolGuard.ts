import type { MessageUpdate } from "$lib/types/MessageUpdate";

/**
 * A gate on outbound MCP tool calls, consulted by `executeToolCalls` around
 * each dispatch. Exists so a policy (today: the ML Assistant compute budget)
 * can refuse a call before it reaches the server and reconcile after it
 * returns, without the dispatch loop knowing anything about the policy.
 */

export interface GuardedToolCall {
	/** URL of the server the call is bound for. */
	serverUrl: string;
	/** Tool name as the server knows it (unsanitized). */
	tool: string;
	args: Record<string, unknown>;
	/**
	 * The dispatch uuid, unique per execution. Deliberately not the provider's
	 * tool call id: some providers reuse ids ("call_0") across rounds, and a
	 * reused key would let a later submission ride an earlier one's booking.
	 */
	callUuid: string;
}

export type GuardVerdict =
	| { allow: true; ticket?: unknown; update?: MessageUpdate }
	/** Refused: `message` goes back to the model as the tool error. Nothing was dispatched. */
	| { allow: false; message: string; update?: MessageUpdate };

export type GuardOutcome =
	/** The server returned a normal result; `text` is its textual payload. */
	| { status: "success"; text: string }
	/** The server answered with an error result — the call verifiably did not do its work. */
	| { status: "error"; text?: string }
	/** The call failed in transport; whether the server acted is unknown. */
	| { status: "transport_error" }
	/** The server asked for interactive input; the call was not completed and will not be resumed. */
	| { status: "elicited" };

export interface ToolCallGuard {
	before(call: GuardedToolCall): Promise<GuardVerdict>;
	/** Called with the ticket from `before` once the call's fate is known. */
	after(ticket: unknown, outcome: GuardOutcome): Promise<MessageUpdate | undefined>;
	/**
	 * Whether a call holding a ticket may park on an elicitation prompt. When
	 * false, `executeToolCalls` declines the prompt and reports `elicited` —
	 * the resume path bypasses guards, so a gated call must never enter it.
	 */
	allowParking: boolean;
}
