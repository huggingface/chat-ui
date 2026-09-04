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
	/** Name the model called, and the key into this request's tool mapping. */
	fnName: string;
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

/**
 * Both guards, `first` consulted first. A refusal from `first` short-circuits,
 * so `second` never sees the call — which is why `first` must be a guard whose
 * `before` acquires nothing: it is the one that can be skipped without a
 * release, and the one whose ticket is dropped when `second` refuses.
 *
 * Only `second` may emit updates from `before`; a refusal there discards
 * nothing of `first`'s because `first` booked nothing to discard.
 */
export function composeGuards(first: ToolCallGuard, second: ToolCallGuard): ToolCallGuard {
	type Tickets = { first: unknown; second: unknown };
	return {
		allowParking: first.allowParking && second.allowParking,
		async before(call) {
			const firstVerdict = await first.before(call);
			if (!firstVerdict.allow) return firstVerdict;
			const secondVerdict = await second.before(call);
			if (!secondVerdict.allow) return secondVerdict;
			return {
				allow: true,
				ticket: { first: firstVerdict.ticket, second: secondVerdict.ticket } satisfies Tickets,
				update: secondVerdict.update,
			};
		},
		async after(ticket, outcome) {
			const { first: firstTicket, second: secondTicket } = ticket as Tickets;
			// Same rule executeToolCalls applies: an allow without a ticket means
			// the guard took no interest in this call, and its `after` is written
			// to read a ticket it never issued. The composite always has a ticket
			// of its own, so without this a guard that opted out would be handed
			// `undefined` and throw on a call that worked.
			if (firstTicket !== undefined) await first.after(firstTicket, outcome);
			if (secondTicket === undefined) return undefined;
			return second.after(secondTicket, outcome);
		},
	};
}
