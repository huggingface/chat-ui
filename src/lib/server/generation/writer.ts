import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import type { GenerationEvent, GenerationStatus } from "$lib/types/Generation";
import type { User } from "$lib/types/User";
import {
	MessageUpdateStatus,
	MessageUpdateType,
	MessageReasoningUpdateType,
	type MessageUpdate,
	type MessageStreamUpdate,
	type MessageReasoningStreamUpdate,
} from "$lib/types/MessageUpdate";
import { registerActiveRun, unregisterActiveRun } from "./finalize";

// Text and reasoning are the only per-token streams; both carry a `token`.
function isStreamToken(e: MessageUpdate): e is MessageStreamUpdate | MessageReasoningStreamUpdate {
	return (
		e.type === MessageUpdateType.Stream ||
		(e.type === MessageUpdateType.Reasoning && e.subtype === MessageReasoningUpdateType.Stream)
	);
}

// If `event` continues the same stream as `tail`, return the two concatenated into
// one event; otherwise null. Coalescing consecutive tokens keeps the event log compact
// (one event per burst, not per token) so replay stays cheap. Text and reasoning never
// merge into each other — they render on separate channels.
export function mergedStreamToken(
	tail: MessageUpdate | undefined,
	event: MessageUpdate
): MessageStreamUpdate | MessageReasoningStreamUpdate | null {
	if (!tail || !isStreamToken(tail) || !isStreamToken(event) || tail.type !== event.type) {
		return null;
	}
	return { ...tail, token: tail.token + event.token };
}

const FLUSH_INTERVAL_MS = 200;
const MATERIALIZE_MS = 3_000;

// Must stay well below the reaper's stale threshold (see reaper.ts), or a live run
// gets reaped between beats. Configurable only so tests can scale both down together.
export function heartbeatMs(): number {
	const raw = config.GENERATION_HEARTBEAT_MS;
	if (raw) {
		const parsed = parseInt(raw, 10);
		if (!isNaN(parsed) && parsed > 0) return parsed;
	}
	return 10_000;
}

export interface GenerationSnapshot {
	content: string;
	reasoning?: string;
	files?: Message["files"];
	routerMetadata?: Message["routerMetadata"];
	/** Compressed for storage (keepalives dropped, stream tokens → length markers). */
	updates?: MessageUpdate[];
}

export interface GenerationWriter {
	/** Fire-and-forget: never throws, never awaited on the hot path. */
	push(event: MessageUpdate): void;
	/**
	 * A caller writing the message out by some other route must read this
	 * synchronously alongside the content it is about to persist, or the two
	 * disagree and a reader replays text it already has — see `materialize`.
	 * Capturing the cursor seals its pending tail so later tokens cannot extend
	 * an event the persisted snapshot claims to cover.
	 */
	currentSeq(): number;
	finish(outcome: { status: GenerationStatus; error?: string }): Promise<void>;
}

export interface CreateGenerationWriterParams {
	generationId: string;
	conversationId: Conversation["_id"];
	messageId: Message["id"];
	userId?: User["_id"];
	sessionId?: string;
	/** Read synchronously at materialisation time so the snapshot and the seq it is stamped with describe the same instant. */
	snapshot: () => GenerationSnapshot;
}

/** Returned only when a run fails to register, so callers never branch on a null writer. */
const NOOP_WRITER: GenerationWriter = {
	push: () => {},
	currentSeq: () => 0,
	finish: async () => {},
};

export async function createGenerationWriter(
	params: CreateGenerationWriterParams
): Promise<GenerationWriter> {
	const { generationId, conversationId, messageId, userId, sessionId, snapshot } = params;
	const now = new Date();

	try {
		await collections.generations.insertOne({
			_id: new ObjectId(),
			generationId,
			conversationId,
			messageId,
			...(userId ? { userId } : {}),
			...(sessionId ? { sessionId } : {}),
			status: "running",
			seq: 0,
			lastHeartbeatAt: now,
			startedAt: now,
			createdAt: now,
			updatedAt: now,
		});
	} catch (err) {
		// A run that cannot register must not take the generation down with it —
		// the caller still streams and still persists the old way.
		logger.error({ err, generationId }, "[generation] failed to register run; events disabled");
		return NOOP_WRITER;
	}

	registerActiveRun(generationId, { conversationId, messageId });

	let seq = 0;
	let pending: GenerationEvent[] = [];
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let finished = false;
	// Serialises every write so events can never land out of order.
	let chain: Promise<void> = Promise.resolve();

	const enqueue = (work: () => Promise<void>): Promise<void> => {
		chain = chain.then(work).catch((err) => {
			logger.error({ err, generationId }, "[generation] write failed");
		});
		return chain;
	};

	const nextEvent = (event: MessageUpdate): GenerationEvent => ({
		_id: new ObjectId(),
		generationId,
		seq: ++seq,
		event,
		createdAt: new Date(),
	});

	const flush = (): Promise<void> => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
		if (pending.length === 0) return chain;
		const batch = pending;
		pending = [];
		return enqueue(async () => {
			await collections.generationEvents.insertMany(batch, { ordered: false });
		});
	};

	const scheduleFlush = (delayMs: number) => {
		if (flushTimer || finished) return;
		flushTimer = setTimeout(() => {
			flushTimer = undefined;
			void flush();
		}, delayMs);
	};

	const materialize = (): Promise<void> => {
		// Snapshot and sequence must be captured in the same synchronous block: an
		// await here would let more tokens land in `content` while `seq` stayed put,
		// and a reader resuming from that seq would replay text it already had.
		const at = seq;
		const snap = snapshot();
		const flushed = flush();
		return enqueue(async () => {
			await flushed;
			// Persist every field the seq covers, not just content/reasoning: materializedSeq
			// is the reattach cursor, so any tool/file/router event at or below it that is not
			// written here would be skipped by a resuming reader and lost if the run dies before
			// the final full save.
			await collections.conversations.updateOne(
				{ _id: conversationId, "messages.id": messageId },
				{
					$set: {
						"messages.$.content": snap.content,
						...(snap.reasoning !== undefined ? { "messages.$.reasoning": snap.reasoning } : {}),
						...(snap.files !== undefined ? { "messages.$.files": snap.files } : {}),
						...(snap.routerMetadata !== undefined
							? { "messages.$.routerMetadata": snap.routerMetadata }
							: {}),
						...(snap.updates !== undefined ? { "messages.$.updates": snap.updates } : {}),
						"messages.$.materializedSeq": at,
						"messages.$.updatedAt": new Date(),
						updatedAt: new Date(),
					},
				}
			);
		});
	};

	const heartbeatTimer = setInterval(() => {
		void enqueue(async () => {
			await collections.generations.updateOne(
				{ generationId },
				{ $set: { lastHeartbeatAt: new Date(), seq, updatedAt: new Date() } }
			);
		});
	}, heartbeatMs());
	heartbeatTimer.unref?.();

	const materializeTimer = setInterval(() => {
		void materialize();
	}, MATERIALIZE_MS);
	materializeTimer.unref?.();

	return {
		currentSeq: () => {
			const at = seq;
			// `flush` synchronously moves pending events out of the coalescing buffer
			// before it queues the database write. A subsequent token therefore gets
			// a new sequence rather than changing an event covered by `at`.
			void flush();
			return at;
		},

		push(event: MessageUpdate) {
			if (finished) return;
			// Dropped, not logged: the heartbeat is the durable liveness signal, and at
			// one keepalive per 100ms these would dominate the collection for no reader.
			if (
				event.type === MessageUpdateType.Status &&
				event.status === MessageUpdateStatus.KeepAlive
			) {
				return;
			}

			// Buffer every event and flush on a timer. Consecutive same-kind stream
			// tokens coalesce; everything else keeps its own event. Pacing writes by the
			// clock rather than per event means no update type — text, reasoning, or some
			// future high-frequency one — can reintroduce per-event write amplification
			// just by joining the pipeline. Order is preserved regardless of flush timing:
			// `seq` is assigned here, and `materialize()` drains pending before it advances
			// `materializedSeq`, so a reader never resumes past an unwritten event.
			const last = pending.at(-1);
			const merged = mergedStreamToken(last?.event, event);
			if (last && merged) {
				last.event = merged;
			} else {
				pending.push(nextEvent(event));
			}
			scheduleFlush(FLUSH_INTERVAL_MS);
		},

		async finish({ status, error }) {
			if (finished) return;
			finished = true;
			unregisterActiveRun(generationId);
			clearInterval(heartbeatTimer);
			clearInterval(materializeTimer);
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}

			await materialize().catch(() => {});
			await enqueue(async () => {
				const endedAt = new Date();
				await collections.generations.updateOne(
					{ generationId },
					{
						$set: {
							status,
							seq,
							endedAt,
							lastHeartbeatAt: endedAt,
							updatedAt: endedAt,
							...(error ? { error } : {}),
						},
					}
				);
			});
		},
	};
}
