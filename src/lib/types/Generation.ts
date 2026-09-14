import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Message } from "./Message";
import type { MessageUpdate } from "./MessageUpdate";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

export type GenerationStatus = "running" | "completed" | "interrupted" | "error";

/**
 * One generation run. Small and written often (heartbeat), so it is deliberately
 * separate from the conversation document: liveness must not get more expensive as
 * the transcript grows.
 */
export interface Generation extends Timestamps {
	_id: ObjectId;
	/** Matches the client-chosen `generationId` on the request that started this run. */
	generationId: string;
	conversationId: Conversation["_id"];
	/** The assistant message this run writes into. */
	messageId: Message["id"];

	// Denormalised from the conversation so user-scoped queries need no join.
	userId?: User["_id"];
	sessionId?: string;

	status: GenerationStatus;
	/** Highest seq assigned so far. */
	seq: number;
	lastHeartbeatAt: Date;
	startedAt: Date;
	endedAt?: Date;
	error?: string;
}

/**
 * Append-only log of a TURN's updates — the event log a subscriber replays and
 * tails. `event` is the wire type the client already parses, so there is no
 * second serialization format to keep in sync.
 *
 * The log is keyed by the turn (conversationId + messageId), not the run: a
 * parked turn is resumed by a new producer with a new generationId, and a
 * per-run log would force every subscriber to discover the new producer and
 * reset its cursor — the flakiness the turn-scoped key exists to remove.
 * `generationId` remains as provenance: which producer appended the event.
 */
export interface GenerationEvent {
	_id: ObjectId;
	generationId: string;
	/** Absent only on events persisted before the log became turn-scoped. */
	conversationId?: Conversation["_id"];
	messageId?: Message["id"];
	/**
	 * Contiguous from 1 across the turn's whole life: a resumed producer
	 * continues where the durable log ends (single writer under the parked-call
	 * lease), so `subscribe(messageId, fromSeq)` is always well-defined.
	 */
	seq: number;
	event: MessageUpdate;
	createdAt: Date;
}
