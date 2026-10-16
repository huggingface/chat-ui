import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { acquireLock, releaseLock } from "$lib/migrations/lock";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import type { QueuedInput } from "$lib/types/QueuedInput";
import {
	cancelAllQueuedInputs,
	claimQueuedInputs,
	hasQueuedInputs,
	releaseQueuedInputs,
} from "./store";

export type QueuedTurnStart = "started" | "busy" | "empty" | "failed";

// the lock only covers the alive check until the first chunk of the new run, then that run is live
export async function startQueuedTurn(conversationId: ObjectId): Promise<QueuedTurnStart> {
	if (!(await hasQueuedInputs(conversationId))) return "empty";
	const lockKey = `queue.drain:${conversationId.toString()}`;
	const lock = await acquireLock(lockKey);
	if (!lock) return "busy";

	let rows: QueuedInput[] = [];
	let reader: ReadableStreamDefaultReader<unknown> | undefined;
	try {
		const conv = await collections.conversations.findOne(
			{ _id: conversationId },
			{ projection: { messages: { $slice: -1 } } }
		);
		if (!conv || !isMlAssistantConversation(conv)) {
			await cancelAllQueuedInputs(conversationId);
			return "empty";
		}
		const latest = conv.messages.at(-1);
		if (latest?.from === "assistant" && (await isTurnAlive(conversationId, latest.id)).alive) {
			return "busy";
		}

		rows = await claimQueuedInputs(conversationId, { status: "started" });
		if (rows.length === 0) return "empty";

		const [{ rebuildIdentity }, { generateConversationResponse }] = await Promise.all([
			import("$lib/server/generation/parkedSweeper"),
			import("$lib/server/generation/conversationRequest"),
		]);
		const { locals } = await rebuildIdentity({
			userId: rows[0].userId,
			sessionId: rows[0].sessionId,
		});
		const data = new FormData();
		data.set(
			"data",
			JSON.stringify({
				inputs: rows.map((row) => row.text).join("\n\n"),
				id: latest?.id ?? conv.rootMessageId,
				generationId: randomUUID(),
			})
		);
		const response = await generateConversationResponse({
			request: new Request("http://queue.internal/conversation", { method: "POST", body: data }),
			locals,
			params: { id: conversationId.toHexString() },
			getClientAddress: () => "queue",
		});
		if (!response.ok || !response.body) throw new Error(`refused with ${response.status}`);
		reader = response.body.getReader();
		await reader.read();
		logger.info(
			{ conversationId: conversationId.toString(), count: rows.length },
			"[queuedInputs] started the next turn from the queue"
		);
	} catch (err) {
		logger.error(
			{ err, conversationId: conversationId.toString() },
			"[queuedInputs] could not start a turn from the queue"
		);
		if (!reader) await releaseQueuedInputs(rows).catch(() => {});
		return "failed";
	} finally {
		await releaseLock(lockKey, lock).catch(() => {});
	}

	const running = reader;
	void (async () => {
		try {
			while (!(await running.read()).done) {
				/* the shared runner persists the turn */
			}
		} finally {
			running.releaseLock();
		}
	})().catch((err) =>
		logger.error(
			{ err, conversationId: conversationId.toString() },
			"[queuedInputs] queued turn failed"
		)
	);
	return "started";
}

export function kickQueuedTurn(conversationId: ObjectId): void {
	void startQueuedTurn(conversationId).catch((err) =>
		logger.error({ err, conversationId: conversationId.toString() }, "[queuedInputs] kick failed")
	);
}

/** a message older than this with no turn running was missed by every kick, a pod died */
const ORPHAN_AFTER_MS = 30_000;
const SWEEP_INTERVAL_MS = 15_000;

export async function sweepQueuedInputs(now = new Date()): Promise<void> {
	const conversations = await collections.queuedInputs.distinct("conversationId", {
		status: "queued",
		createdAt: { $lt: new Date(now.getTime() - ORPHAN_AFTER_MS) },
	});
	for (const conversationId of conversations.slice(0, 20)) {
		await startQueuedTurn(conversationId);
	}
}

export class QueuedInputSweeper {
	private static instance: QueuedInputSweeper;

	private constructor() {
		const interval = setInterval(() => {
			sweepQueuedInputs().catch((err) => logger.error({ err }, "[queuedInputs] sweep failed"));
		}, SWEEP_INTERVAL_MS);
		interval.unref?.();
		onExit(() => clearInterval(interval));
	}

	public static getInstance(): QueuedInputSweeper {
		if (!QueuedInputSweeper.instance) {
			QueuedInputSweeper.instance = new QueuedInputSweeper();
		}
		return QueuedInputSweeper.instance;
	}
}
