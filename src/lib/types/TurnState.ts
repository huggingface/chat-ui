import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

/**
 * The turn lifecycle. Exactly one of these is true of a turn at any moment,
 * and the client renders THIS — never an inference over event patterns.
 *
 * running         a producer holds the turn and is generating
 * waiting         parked on the wait tool until an absolute deadline
 * awaiting_input  parked on a question only the user can answer
 * done            the turn ended with an answer (interrupted or not)
 * failed          the turn ended on an error
 */
export type TurnStatus = "running" | "waiting" | "awaiting_input" | "done" | "failed";

/**
 * One turn's authoritative liveness record — a materialized "latest" of the
 * in-band turnState events in the turn log. Small and rewritten often, so it
 * lives outside the conversation document, like `generations`.
 *
 * Written only by whoever holds the turn: the producer under the request, or
 * the wait/ask tools inside it. The terminal write is a compare-and-swap on
 * (producerId, status: "running"), so a park recorded mid-run cannot be
 * clobbered by the producer's own wind-down.
 */
export interface TurnState extends Timestamps {
	_id: ObjectId;
	conversationId: Conversation["_id"];
	messageId: Message["id"];

	// Denormalised from the conversation so user-scoped queries need no join.
	userId?: User["_id"];
	sessionId?: string;

	status: TurnStatus;
	/** Absolute deadline, present while status === "waiting". */
	waitUntil?: Date;
	waitReason?: string;
	/** The producer (generationId) that wrote the current status. */
	producerId: string;
	endedAt?: Date;
	error?: string;
}
