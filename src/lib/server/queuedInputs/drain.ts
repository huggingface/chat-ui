import { randomUUID } from "crypto";
import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { onExit } from "$lib/server/exitHandler";
import { acquireLock, releaseLock } from "$lib/migrations/lock";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { isTurnAlive } from "$lib/server/generation/turnLog";
import type { Message } from "$lib/types/Message";
import type { QueuedInput } from "$lib/types/QueuedInput";
import {
	cancelAllQueuedInputs,
	claimQueuedInputs,
	failQueuedInputs,
	hasQueuedInputs,
	joinQueuedInputs,
	releaseQueuedInputs,
} from "./store";

export type QueuedTurnStart = "started" | "busy" | "empty" | "failed";

export const TURN_BUSY_MESSAGE =
	"ML Intern is still working on this conversation. Your message can be queued for its next step.";

/** held until the new run has a generation row, working lets a pending question through and alive does not */
export async function claimTurnStart(
	conversationId: ObjectId,
	latest: Pick<Message, "id" | "from"> | undefined,
	refuse: "working" | "alive"
): Promise<(() => Promise<void>) | undefined> {
	const key = `queue.drain:${conversationId.toString()}`;
	const lock = await acquireLock(key);
	if (!lock) return undefined;
	const release = () => releaseLock(key, lock).catch(() => {});
	if (latest?.from === "assistant") {
		const turn = await isTurnAlive(conversationId, latest.id);
		const busy =
			refuse === "alive" ? turn.alive : turn.status === "running" || turn.status === "parked";
		if (busy) {
			await release();
			return undefined;
		}
	}
	return release;
}

export async function startQueuedTurn(conversationId: ObjectId): Promise<QueuedTurnStart> {
	if (!(await hasQueuedInputs(conversationId))) return "empty";
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { messages: { $slice: -1 } } }
	);
	if (!conv || !isMlAssistantConversation(conv)) {
		await cancelAllQueuedInputs(conversationId);
		return "empty";
	}
	const latest = conv.messages.at(-1);
	const release = await claimTurnStart(conversationId, latest, "alive");
	if (!release) return "busy";

	let rows: QueuedInput[] = [];
	let reader: ReadableStreamDefaultReader<unknown> | undefined;
	try {
		rows = await claimQueuedInputs(conversationId, { status: "started" });
		if (rows.length === 0) return "empty";

		const [{ rebuildIdentity }, { generateConversationResponse }] = await Promise.all([
			import("$lib/server/generation/parkedSweeper"),
			import("$lib/server/generation/conversationRequest"),
		]);
		const { locals, tokenExpired } = await rebuildIdentity({
			userId: rows[0].userId,
			sessionId: rows[0].sessionId,
		});
		// the server key would pay for a turn the user did not start themselves
		if (config.USE_USER_TOKEN === "true" && tokenExpired) {
			await failQueuedInputs(
				{ _id: { $in: rows.map((row) => row._id) } },
				"Your session expired before ML Intern could start this. Sign in again and send it."
			);
			return "failed";
		}
		const data = new FormData();
		data.set(
			"data",
			JSON.stringify({
				inputs: joinQueuedInputs(rows),
				id: latest?.id ?? conv.rootMessageId,
				generationId: randomUUID(),
			})
		);
		const response = await generateConversationResponse({
			request: new Request("http://queue.internal/conversation", { method: "POST", body: data }),
			locals,
			params: { id: conversationId.toHexString() },
			// a shared constant would put every user in one ip rate limit bucket
			getClientAddress: () =>
				`queue:${rows[0].userId?.toString() ?? rows[0].sessionId ?? conversationId.toString()}`,
			queuedStart: true,
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
		if (!reader) {
			await releaseQueuedInputs(rows, startRefusal(err)).catch(() => {});
		}
		return "failed";
	} finally {
		await release();
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

function startRefusal(err: unknown): string {
	const status =
		typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
			? err.status
			: undefined;
	if (status === 429)
		return "ML Intern hit a rate limit before it could start this. Send it again.";
	return "ML Intern could not start a turn with this message. Send it again.";
}

export function kickQueuedTurn(conversationId: ObjectId): void {
	void startQueuedTurn(conversationId).catch((err) =>
		logger.error({ err, conversationId: conversationId.toString() }, "[queuedInputs] kick failed")
	);
}

/** a message older than this with no turn running was missed by every kick, a pod died */
const ORPHAN_AFTER_MS = 30_000;
const SWEEP_INTERVAL_MS = 15_000;
const SWEEP_BATCH = 20;

/** least recently looked at first, so conversations parked on a question cannot starve the rest */
export async function sweepQueuedInputs(now = new Date()): Promise<void> {
	const rows = await collections.queuedInputs
		.find(
			{
				status: "queued",
				createdAt: { $lt: new Date(now.getTime() - ORPHAN_AFTER_MS) },
				$or: [
					{ checkedAt: { $exists: false } },
					{ checkedAt: { $lt: new Date(now.getTime() - SWEEP_INTERVAL_MS) } },
				],
			},
			{ projection: { conversationId: 1 } }
		)
		.sort({ checkedAt: 1, createdAt: 1 })
		.limit(SWEEP_BATCH * 5)
		.toArray();
	const conversations = [
		...new Map(rows.map((row) => [row.conversationId.toString(), row.conversationId])).values(),
	].slice(0, SWEEP_BATCH);
	for (const conversationId of conversations) {
		await collections.queuedInputs.updateMany(
			{ conversationId, status: "queued" },
			{ $set: { checkedAt: now } }
		);
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
