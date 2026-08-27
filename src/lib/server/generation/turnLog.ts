import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import type { Generation, GenerationEvent } from "$lib/types/Generation";
import type { Message } from "$lib/types/Message";

/**
 * Read side of the turn-scoped event log (see GenerationEvent). A turn —
 * one assistant message — is written by a series of producers: the HTTP run,
 * then any number of sweeper resumes, each a new generation continuing the
 * same sequence. Subscribers care about the turn, not the producers, so
 * everything here is keyed by (conversationId, messageId).
 */

export async function latestTurnGeneration(
	conversationId: ObjectId,
	messageId: Message["id"]
): Promise<Generation | null> {
	return collections.generations.findOne(
		{ conversationId, messageId },
		{ sort: { startedAt: -1 } }
	);
}

export interface TurnLiveness {
	/** Whether the turn can still produce events. */
	alive: boolean;
	/**
	 * The newest producer's terminal status once the turn is over ("gone" when
	 * it never had one); "running" or "parked" while it is alive.
	 */
	status: string;
}

/**
 * A turn is alive while a producer is running, or while a parked-call row is
 * waiting for its deadline or being claimed ("resuming" covers the gap between
 * the sweeper's claim and the resumed producer's registration). A parked wait
 * is a nap, not an ending — a subscriber that treated it as terminal would
 * have to rediscover the resume, which is the failure mode this design
 * removes.
 */
export async function isTurnAlive(
	conversationId: ObjectId,
	messageId: Message["id"]
): Promise<TurnLiveness> {
	const newest = await latestTurnGeneration(conversationId, messageId);
	if (newest?.status === "running") return { alive: true, status: "running" };

	const parked = await collections.parkedCalls.countDocuments({
		conversationId,
		messageId,
		status: { $in: ["waiting", "resuming"] },
	});
	if (parked > 0) return { alive: true, status: "parked" };

	return { alive: false, status: newest?.status ?? "gone" };
}

/**
 * The next batch of the turn's events after `afterSeq`, in sequence order.
 * Callers own gap handling: an unordered multi-document insert is not
 * atomically visible, so a reader must not advance past a sequence that may
 * still appear on the next poll.
 */
export async function turnEventsAfter(
	conversationId: ObjectId,
	messageId: Message["id"],
	afterSeq: number,
	limit: number
): Promise<GenerationEvent[]> {
	return collections.generationEvents
		.find({ conversationId, messageId, seq: { $gt: afterSeq } })
		.sort({ seq: 1 })
		.limit(limit)
		.toArray();
}
