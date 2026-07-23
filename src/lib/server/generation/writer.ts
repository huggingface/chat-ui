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
	type MessageUpdate,
} from "$lib/types/MessageUpdate";

const STREAM_FLUSH_MS = 200;
const HEARTBEAT_MS = 10_000;
const MATERIALIZE_MS = 3_000;

export function generationEventsEnabled(): boolean {
	return config.ENABLE_GENERATION_EVENTS === "true";
}

export interface GenerationSnapshot {
	content: string;
	reasoning?: string;
}

export interface GenerationWriter {
	/** Fire-and-forget: never throws, never awaited on the hot path. */
	push(event: MessageUpdate): void;
	/**
	 * A caller writing the message out by some other route must read this
	 * synchronously alongside the content it is about to persist, or the two
	 * disagree and a reader replays text it already has — see `materialize`.
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

/** A no-op rather than null, so callers never branch on whether the feature is enabled. */
const NOOP_WRITER: GenerationWriter = {
	push: () => {},
	currentSeq: () => 0,
	finish: async () => {},
};

export async function createGenerationWriter(
	params: CreateGenerationWriterParams
): Promise<GenerationWriter> {
	if (!generationEventsEnabled()) return NOOP_WRITER;

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
		const { content, reasoning } = snapshot();
		const flushed = flush();
		return enqueue(async () => {
			await flushed;
			await collections.conversations.updateOne(
				{ _id: conversationId, "messages.id": messageId },
				{
					$set: {
						"messages.$.content": content,
						...(reasoning !== undefined ? { "messages.$.reasoning": reasoning } : {}),
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
	}, HEARTBEAT_MS);
	heartbeatTimer.unref?.();

	const materializeTimer = setInterval(() => {
		void materialize();
	}, MATERIALIZE_MS);
	materializeTimer.unref?.();

	return {
		currentSeq: () => seq,

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

			if (event.type === MessageUpdateType.Stream) {
				const last = pending.at(-1);
				// Merge into the unflushed tail rather than minting a seq per token, so a
				// replay up to any seq reconstructs `content` exactly.
				if (last && last.event.type === MessageUpdateType.Stream) {
					last.event = { ...last.event, token: last.event.token + event.token };
					scheduleFlush(STREAM_FLUSH_MS);
					return;
				}
				pending.push({
					_id: new ObjectId(),
					generationId,
					seq: ++seq,
					event,
					createdAt: new Date(),
				});
				scheduleFlush(STREAM_FLUSH_MS);
				return;
			}

			pending.push({
				_id: new ObjectId(),
				generationId,
				seq: ++seq,
				event,
				createdAt: new Date(),
			});
			// Flush now, not on a timer: these are ordered against the text around them.
			void flush();
		},

		async finish({ status, error }) {
			if (finished) return;
			finished = true;
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
