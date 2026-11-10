import { collections } from "$lib/server/database";
import { isTurnAlive, type TurnLiveness } from "$lib/server/generation/turnLog";
import { hasQueuedInputs } from "$lib/server/queuedInputs/store";
import type { McpElicitation, PendingKind } from "$lib/types/McpElicitation";
import type { User } from "$lib/types/User";
import type { RunId, RunMessage, RunQuestion, RunStatus, RunTurn } from "./types";

export function toRunQuestion(row: McpElicitation): RunQuestion {
	return {
		elicitationId: row.elicitationId,
		generationId: row.generationId,
		kind: row.pending?.kind,
		messageId: row.pending?.messageId,
		request: row.request,
		content: row.content,
		choices: row.slackChoices,
		choiceRevision: row.slackChoiceRevision,
	};
}

export async function runExists(conversationId: RunId): Promise<boolean> {
	return (
		(await collections.conversations.countDocuments({ _id: conversationId }, { limit: 1 })) > 0
	);
}

export async function findRunOwner(userId: User["_id"]): Promise<User | null> {
	return collections.users.findOne({ _id: userId });
}

export async function ownerUsername(userId: User["_id"]): Promise<string | undefined> {
	const user = await collections.users.findOne({ _id: userId }, { projection: { username: 1 } });
	return user?.username;
}

export async function findQuestion(
	conversationId: RunId,
	elicitationId: string,
	filter: { pending?: boolean; kind?: PendingKind } = {}
): Promise<RunQuestion | undefined> {
	const row = await collections.mcpElicitations.findOne({
		conversationId,
		elicitationId,
		...(filter.pending ? { status: "pending" as const } : {}),
		...(filter.kind ? { "pending.kind": filter.kind } : {}),
	});
	return row ? toRunQuestion(row) : undefined;
}

export async function readLatestMessage(conversationId: RunId): Promise<RunMessage | undefined> {
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { messages: { $slice: -1 } } }
	);
	return conv?.messages.at(-1);
}

/** the newest message, with liveness only for an assistant message */
export async function readLatest(
	conversationId: RunId
): Promise<{ message?: RunMessage; live?: TurnLiveness }> {
	const message = await readLatestMessage(conversationId);
	if (message?.from !== "assistant") return { message };
	return { message, live: await isTurnAlive(conversationId, message.id) };
}

/** the newest turn on this generation, dead and interrupted or failed */
export async function canRetry(
	conversationId: RunId,
	messageId: string,
	generationId: string | undefined
): Promise<boolean> {
	const last = await readLatestMessage(conversationId);
	if (
		!last ||
		last.id !== messageId ||
		last.generationId !== generationId ||
		(await isTurnAlive(conversationId, last.id)).alive
	)
		return false;
	const state = await collections.turnStates.findOne({ conversationId, messageId: last.id });
	return !!last.interrupted || state?.status === "failed";
}

/** nothing producing, parked or queued, so a client can stop watching */
export async function isRunSettled(conversationId: RunId): Promise<boolean> {
	const message = await readLatestMessage(conversationId);
	if (message && (await isTurnAlive(conversationId, message.id)).alive) return false;
	return !(await hasQueuedInputs(conversationId));
}

export { hasQueuedInputs as hasPendingSteers };

export async function readTurn(conversationId: RunId): Promise<RunTurn | undefined> {
	const message = await readLatestMessage(conversationId);
	if (message?.from !== "assistant") return;
	const state = await collections.turnStates.findOne({ conversationId, messageId: message.id });
	if (!state) return;
	if (
		await collections.mcpElicitations.findOne({
			conversationId,
			"pending.messageId": message.id,
			slackSkippedByInputId: { $exists: true },
		})
	)
		return { kind: "superseded", message };
	const live = await isTurnAlive(conversationId, message.id);
	const question = await collections.mcpElicitations.findOne({
		conversationId,
		status: "pending",
		$or: [{ "pending.messageId": message.id }, { generationId: message.generationId }],
	});
	const answered = await collections.mcpElicitations
		.find({
			conversationId,
			"pending.messageId": message.id,
			"pending.kind": "ask",
			status: "resolved",
			action: "accept",
			slackShareAnswer: true,
		})
		.sort({ createdAt: -1, _id: -1 })
		.limit(1)
		.next();
	const original = message.queuedContinuationOf
		? await collections.conversations.findOne(
				{ _id: conversationId },
				{ projection: { messages: { $elemMatch: { id: message.queuedContinuationOf } } } }
			)
		: undefined;
	return {
		kind: "turn",
		message,
		state,
		live,
		question: question ? toRunQuestion(question) : undefined,
		sharedAnswer: answered ? toRunQuestion(answered) : undefined,
		startedAt: original?.messages[0]?.createdAt ?? message.createdAt ?? state.createdAt,
	};
}

export async function readRunStatus(conversationId: RunId): Promise<RunStatus | undefined> {
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{
			projection: {
				"messages.id": 1,
				"messages.from": 1,
				"messages.queuedContinuationOf": 1,
				"messages.createdAt": 1,
				mlBudget: 1,
				plan: 1,
			},
		}
	);
	const message = conv?.messages.at(-1);
	if (!conv || message?.from !== "assistant") return;
	const cardMessageId = message.queuedContinuationOf ?? message.id;
	// the plan outlives its turn, a follow up shows none until it plans again
	const startedAt = conv.messages.find((m) => m.id === cardMessageId)?.createdAt;
	const plan = conv.plan && (!startedAt || conv.plan.updatedAt >= startedAt) ? conv.plan : null;
	return { messageId: message.id, cardMessageId, budget: conv.mlBudget, plan };
}

export async function supersededQuestions(conversationId: RunId): Promise<RunQuestion[]> {
	const rows = await collections.mcpElicitations
		.find({ conversationId, slackSkippedByInputId: { $exists: true } })
		.toArray();
	return rows.map(toRunQuestion);
}

/** answers a client asked to echo, once the user gave them */
export async function sharedAnswers(conversationId: RunId): Promise<RunQuestion[]> {
	const rows = await collections.mcpElicitations
		.find({
			conversationId,
			status: "resolved",
			action: "accept",
			resolution: "user",
			slackShareAnswer: true,
			"pending.kind": "ask",
		})
		.toArray();
	return rows.map(toRunQuestion);
}

export async function exportTrace(
	conversationId: RunId
): Promise<{ filename: string; content: string } | undefined> {
	const conv = await collections.conversations.findOne(
		{ _id: conversationId },
		{ projection: { messages: 1 } }
	);
	if (!conv) return;
	return {
		filename: `ml-intern-${conv._id}.jsonl`,
		content: conv.messages.map((m) => JSON.stringify(m)).join("\n"),
	};
}
