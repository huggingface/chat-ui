import type { ObjectId } from "mongodb";
import type { Conversation } from "./Conversation";
import type { Timestamps } from "./Timestamps";
import type { User } from "./User";

/**
 * Why a turn is parked. `timer` is the only kind today: the model asked to be
 * woken after a delay instead of re-polling something that will not have changed.
 * MCP tasks are the expected second kind — a call parked on a task handle rather
 * than a clock — which is why this is a discriminator and not a boolean.
 */
export type ParkedCallKind = "timer";

/**
 * A tool call that ended its turn and expects to be resumed.
 *
 * In the database because the pod that resumes need not be the pod that parked,
 * and because the wake can come minutes or hours later — long after the request
 * that started the turn is gone. Everything the sweeper needs to rebuild that
 * turn's context lives here or on the conversation; nothing is held in memory.
 */
export interface ParkedCall extends Timestamps {
	_id: ObjectId;
	parkedCallId: string;
	conversationId: Conversation["_id"];
	generationId?: string;
	/** The assistant message the parked turn writes into; the resume continues it in place. */
	messageId: string;
	/** Provider-issued id of the call being parked, and the uuid of its Tool updates. */
	toolCallId: string;
	toolUuid: string;

	kind: ParkedCallKind;
	/**
	 * `resuming` is the claim: a sweeper transitions out of `waiting` atomically so
	 * two pods cannot both wake the same turn. A row left in `resuming` is one whose
	 * pod died mid-resume, which is why `attempts` is counted.
	 */
	status: "waiting" | "resuming" | "resumed" | "abandoned";
	/** When the sweeper should wake this. Indexed with `status` — that pair is the sweep. */
	resumeAt: Date;
	/** Model-authored: what it is waiting for. Display text, never markup. */
	reason: string;

	/**
	 * Whose turn this is. The sweeper has no request to read an identity from, so it
	 * rebuilds one from here — which also means a resume can only ever act as the
	 * user who parked it.
	 */
	userId?: User["_id"];
	sessionId?: string;

	/** Set when a sweeper claims the row, so two pods cannot resume the same turn. */
	takenAt?: Date;
	resumedAt?: Date;
	/** Claims that failed. A row that cannot be resumed is abandoned rather than retried forever. */
	attempts: number;
	/** Why it was abandoned, for the tool result the model reads on the next turn. */
	abandonedReason?: string;
}
