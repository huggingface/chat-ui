import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { TurnStatus } from "$lib/types/TurnState";
import type { User } from "$lib/types/User";
import { MessageUpdateType, type MessageTurnStateUpdate } from "$lib/types/MessageUpdate";

/**
 * The single vocabulary for turn lifecycle transitions. Every producer — the
 * HTTP route, the sweeper, the wait and ask tools inside a run — goes through
 * here, which maintains the invariant the design rests on: each transition
 * updates the authoritative state document AND returns the in-band event for
 * the caller to send through its normal update pipeline, so the log, the live
 * stream, and the persisted message all carry the same lifecycle.
 *
 * Callers emit the returned update themselves rather than this module doing
 * it, because emission differs per producer (the route's `update()`, the
 * sweeper's `apply()`, a tool's elicitation sink) and each already feeds the
 * writer, the client, and the message in its own correct order.
 */

export interface TurnKey {
	conversationId: Conversation["_id"];
	messageId: Message["id"];
	/** The generation currently holding the turn. */
	producerId: string;
	userId?: User["_id"];
	sessionId?: string;
}

function buildUpdate(
	state: TurnStatus,
	extras: { until?: Date; reason?: string; error?: string } = {}
): MessageTurnStateUpdate {
	return {
		type: MessageUpdateType.TurnState,
		state,
		serverNow: Date.now(),
		...(extras.until ? { until: extras.until.getTime() } : {}),
		...(extras.reason ? { reason: extras.reason } : {}),
		...(extras.error ? { error: extras.error } : {}),
	};
}

/** A producer took (or resumed) the turn. */
export async function turnRunning(key: TurnKey): Promise<MessageTurnStateUpdate> {
	const now = new Date();
	await collections.turnStates
		.updateOne(
			{ conversationId: key.conversationId, messageId: key.messageId },
			{
				$set: {
					status: "running" satisfies TurnStatus,
					producerId: key.producerId,
					...(key.userId ? { userId: key.userId } : {}),
					...(key.sessionId ? { sessionId: key.sessionId } : {}),
					updatedAt: now,
				},
				$unset: { waitUntil: "", waitReason: "", endedAt: "", error: "" },
				$setOnInsert: { _id: new ObjectId(), createdAt: now },
			},
			{ upsert: true }
		)
		.catch((err) => logger.error({ err }, "[turnState] failed to record running"));
	return buildUpdate("running");
}

/** The turn parked on the wait tool until an absolute deadline. */
export async function turnWaiting(
	key: TurnKey,
	park: { until: Date; reason: string }
): Promise<MessageTurnStateUpdate> {
	const now = new Date();
	await collections.turnStates
		.updateOne(
			{ conversationId: key.conversationId, messageId: key.messageId },
			{
				$set: {
					status: "waiting" satisfies TurnStatus,
					producerId: key.producerId,
					waitUntil: park.until,
					waitReason: park.reason,
					...(key.userId ? { userId: key.userId } : {}),
					...(key.sessionId ? { sessionId: key.sessionId } : {}),
					updatedAt: now,
				},
				$unset: { endedAt: "", error: "" },
				$setOnInsert: { _id: new ObjectId(), createdAt: now },
			},
			{ upsert: true }
		)
		.catch((err) => logger.error({ err }, "[turnState] failed to record waiting"));
	return buildUpdate("waiting", park);
}

/** The turn parked on a question only the user can answer. */
export async function turnAwaitingInput(key: TurnKey): Promise<MessageTurnStateUpdate> {
	const now = new Date();
	await collections.turnStates
		.updateOne(
			{ conversationId: key.conversationId, messageId: key.messageId },
			{
				$set: {
					status: "awaiting_input" satisfies TurnStatus,
					producerId: key.producerId,
					...(key.userId ? { userId: key.userId } : {}),
					...(key.sessionId ? { sessionId: key.sessionId } : {}),
					updatedAt: now,
				},
				$unset: { waitUntil: "", waitReason: "", endedAt: "", error: "" },
				$setOnInsert: { _id: new ObjectId(), createdAt: now },
			},
			{ upsert: true }
		)
		.catch((err) => logger.error({ err }, "[turnState] failed to record awaiting_input"));
	return buildUpdate("awaiting_input");
}

/**
 * A parked turn nothing will ever resume: the sweeper abandoned its row (the
 * conversation or model is gone, or resume attempts ran out). Without this,
 * the state document stays `waiting` forever — isTurnAlive reports the turn
 * alive, subscriptions churn on heartbeats, and the client sits on an
 * "overdue" banner for a wake that cannot come.
 *
 * CAS on the non-terminal states only — a terminal state some producer wrote
 * meanwhile stands. There is no producer to emit through here, so the caller
 * persists the returned update straight into the message instead; the next
 * snapshot reads terminal even though no live subscriber gets it in-band.
 */
export async function turnAbandoned(
	conversationId: Conversation["_id"],
	messageId: Message["id"],
	error: string
): Promise<MessageTurnStateUpdate | null> {
	const now = new Date();
	try {
		const result = await collections.turnStates.updateOne(
			{ conversationId, messageId, status: { $in: ["waiting", "running"] } },
			{ $set: { status: "failed" satisfies TurnStatus, endedAt: now, updatedAt: now, error } }
		);
		if (result.matchedCount === 0) return null;
	} catch (err) {
		logger.error({ err }, "[turnState] failed to record abandonment");
		return null;
	}
	return buildUpdate("failed", { error });
}

/**
 * Terminal transition, as a compare-and-swap: only the producer that still
 * holds the turn in "running" may end it. A park written mid-run (the wait or
 * ask tool moved the state on) makes the CAS miss, and the parked state
 * stands — the caller gets null and emits nothing.
 */
export async function turnEnded(
	key: TurnKey,
	outcome: { failed: boolean; error?: string }
): Promise<MessageTurnStateUpdate | null> {
	const now = new Date();
	const status: TurnStatus = outcome.failed ? "failed" : "done";
	try {
		const result = await collections.turnStates.updateOne(
			{
				conversationId: key.conversationId,
				messageId: key.messageId,
				producerId: key.producerId,
				status: "running",
			},
			{
				$set: {
					status,
					endedAt: now,
					updatedAt: now,
					...(outcome.error ? { error: outcome.error } : {}),
				},
			}
		);
		if (result.matchedCount === 0) return null;
	} catch (err) {
		logger.error({ err }, "[turnState] failed to record turn end");
		return null;
	}
	return buildUpdate(status, outcome.error ? { error: outcome.error } : {});
}
