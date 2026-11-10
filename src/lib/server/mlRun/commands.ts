import { randomUUID } from "node:crypto";
import { error } from "@sveltejs/kit";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { resolveMlAssistantModel } from "$lib/server/mlAssistantModels";
import { generateConversationResponse } from "$lib/server/generation/conversationRequest";
import { loadMcpSelection } from "$lib/server/mcp/savedSelection";
import { enqueueInput } from "$lib/server/queuedInputs/store";
import { wakeParkForQueuedInput } from "$lib/server/queuedInputs/deliver";
import { kickQueuedTurn } from "$lib/server/queuedInputs/drain";
import { usdToMicroUsd } from "$lib/utils/mlBudget";
import type { Conversation, ManagedBy } from "$lib/types/Conversation";
import type { QueuedInput } from "$lib/types/QueuedInput";
import type { User } from "$lib/types/User";
import type { RunId, TurnInput } from "./types";

export { submitElicitationAnswer as answerQuestion } from "$lib/server/mcp/elicitation";
/** the harness continues an answered assistant question itself, with no new request */
export { kickAnsweredAsk as continueAnsweredAsk } from "$lib/server/generation/askResume";
export { QueueFullError, QueuedInputTooLongError } from "$lib/server/queuedInputs/store";

/** an existing session is left as it is */
export async function openRunSession(opts: {
	conversationId: RunId;
	user: User;
	sessionId?: string;
	managedBy: ManagedBy;
	title: string;
	budgetUsd: number;
}): Promise<void> {
	const model = resolveMlAssistantModel(undefined);
	if (!model || !models.some((m) => m.id === model))
		throw new Error("No ML Intern model is configured.");
	const now = new Date();
	const root = {
		id: randomUUID(),
		from: "system" as const,
		content: "",
		children: [],
		ancestors: [],
		createdAt: now,
		updatedAt: now,
	};
	const conversation: Conversation = {
		_id: opts.conversationId,
		userId: opts.user._id,
		...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
		model,
		title: opts.title,
		managedBy: opts.managedBy,
		preprompt: "",
		mlAssistant: true,
		rootMessageId: root.id,
		messages: [root],
		createdAt: now,
		updatedAt: now,
		mlBudget: { totalMicroUsd: usdToMicroUsd(opts.budgetUsd), spentMicroUsd: 0, reservations: [] },
	};
	await collections.conversations.updateOne(
		{ _id: conversation._id },
		{ $setOnInsert: conversation },
		{ upsert: true }
	);
}

export async function discardRunSession(conversationId: RunId): Promise<void> {
	await collections.conversations.deleteOne({ _id: conversationId });
}

/** for sessions created before managedBy was stored */
export async function backfillManagedBy(conversationId: RunId, managedBy: ManagedBy) {
	await collections.conversations.updateOne(
		{ _id: conversationId, managedBy: { $exists: false } },
		{ $set: { managedBy } }
	);
}

/** drains the same response as the web ui, the harness persists the turn */
export async function sendTurn(opts: {
	conversationId: RunId;
	locals: App.Locals;
	client: ManagedBy["kind"];
	input: TurnInput;
	/** the saved mcp servers of the owner, never for a session on a shared credential */
	personalTools: boolean;
	onMcpUnavailable?: () => Promise<void>;
}): Promise<void> {
	const { conversationId, locals, input } = opts;
	const user = locals.user;
	const conv =
		user && (await collections.conversations.findOne({ _id: conversationId, userId: user._id }));
	if (!user || !conv) throw new Error("This conversation no longer exists.");
	// loaded every turn, including retries and answered questions
	const saved = opts.personalTools ? await loadMcpSelection(user._id) : undefined;
	const selection = saved?.status === "ok" ? saved.selection : undefined;
	// unreadable after a key rotation, run with preset tools and say so
	if (saved?.status === "unavailable") await opts.onMcpUnavailable?.().catch(() => {});
	const latest = conv.messages[conv.messages.length - 1];
	const data = new FormData();
	data.set(
		"data",
		JSON.stringify({
			...selection,
			...(input.text ? { inputs: input.text } : {}),
			...(input.resumeElicitationId ? { resumeElicitationId: input.resumeElicitationId } : {}),
			...(input.retry ? { is_retry: true } : {}),
			id: latest?.id ?? conv.rootMessageId,
			generationId: randomUUID(),
		})
	);
	for (const file of input.files ?? []) {
		data.append(
			"files",
			new Blob([Buffer.from(await file.arrayBuffer()).toString("base64")], { type: file.type }),
			`base64;${file.name}`
		);
	}
	const response = await generateConversationResponse({
		request: new Request(`http://${opts.client}.internal/conversation`, {
			method: "POST",
			body: data,
		}),
		locals,
		params: { id: conversationId.toHexString() },
		getClientAddress: () => opts.client,
	});
	if (!response.ok) error(response.status, `ML Intern rejected this turn (${response.status}).`);
	const reader = response.body?.getReader();
	if (!reader) return;
	try {
		while (!(await reader.read()).done) {
			/* the shared runner persists state */
		}
	} finally {
		reader.releaseLock();
	}
}

/** stops the producer and durable waits and questions, remote compute stays tracked */
export async function stopRun(opts: {
	conversationId: RunId;
	locals: App.Locals;
	reason: string;
}): Promise<void> {
	const { conversationId, reason } = opts;
	const { stopConversation } = await import("$lib/server/generation/stopConversation");
	await stopConversation({
		params: { id: conversationId.toHexString() },
		locals: opts.locals,
		request: new Request("http://run.internal/stop", { method: "POST" }),
	});
	const now = new Date();
	await collections.parkedCalls.updateMany(
		{ conversationId, status: "waiting" },
		{ $set: { status: "abandoned", abandonedReason: reason, updatedAt: now } }
	);
	await collections.mcpElicitations.updateMany(
		{ conversationId, status: "pending" },
		{
			$set: {
				status: "resolved",
				action: "cancel",
				resolution: "aborted",
				resolvedAt: now,
				updatedAt: now,
				resume: { status: "abandoned", takenAt: now, attempts: 0, abandonedReason: reason },
			},
		}
	);
	const parked = await collections.turnStates.findOneAndUpdate(
		{ conversationId, status: { $in: ["waiting", "awaiting_input"] } },
		{ $set: { status: "failed", error: reason, endedAt: now, updatedAt: now } },
		{ returnDocument: "after" }
	);
	if (parked) {
		await collections.abortedGenerations.deleteOne({ conversationId, updatedAt: { $lte: now } });
		await collections.conversations.updateOne(
			{ _id: conversationId, "messages.id": parked.messageId },
			{ $set: { "messages.$.interrupted": true, updatedAt: now } }
		);
	}
}

/**
 * a new owner request supersedes a pending ask, never a budget approval, superseded means the
 * caller must stop the run, review means the new turn may go ahead
 */
export async function supersedeQuestion(opts: {
	conversationId: RunId;
	messageId: string;
	inputId: string;
	reason: string;
}): Promise<"superseded" | "review" | "none"> {
	const { conversationId, messageId, inputId } = opts;
	const now = new Date();
	const result = await collections.mcpElicitations.findOneAndUpdate(
		{
			conversationId,
			"pending.kind": "ask",
			// the new turn closes a publish card and writes its review result
			"pending.publish": { $exists: false },
			"pending.messageId": messageId,
			$or: [
				{ status: "pending", slackSubmitting: { $ne: true } },
				{ slackSkippedByInputId: inputId },
			],
		},
		{
			$set: {
				status: "resolved",
				action: "cancel",
				resolution: "user",
				resolvedAt: now,
				updatedAt: now,
				slackSkippedByInputId: inputId,
				resume: { status: "abandoned", takenAt: now, attempts: 0, abandonedReason: opts.reason },
			},
		},
		{ returnDocument: "after" }
	);
	if (result) return "superseded";
	// let it through, the new turn detaches the review, a stop would resolve it as aborted
	const review = await collections.mcpElicitations.findOne({
		conversationId,
		$or: [
			{ "pending.kind": "review" },
			{ "pending.kind": "ask", "pending.publish": { $exists: true } },
		],
		"pending.messageId": messageId,
		status: "pending",
	});
	return review ? "review" : "none";
}

/** joins the busy turn at its next step, or starts the next turn */
export async function steerRun(opts: {
	conversationId: RunId;
	text: string;
	source: QueuedInput["source"];
	userId: User["_id"];
	sessionId?: string;
}): Promise<void> {
	await enqueueInput(opts);
	await wakeParkForQueuedInput(opts.conversationId);
	kickQueuedTurn(opts.conversationId);
}

export async function stageChoice(
	conversationId: RunId,
	elicitationId: string,
	fieldIndex: number,
	optionIndex: number
): Promise<void> {
	await collections.mcpElicitations.updateOne(
		{ conversationId, elicitationId, status: "pending", slackSubmitting: { $ne: true } },
		{ $set: { [`slackChoices.${fieldIndex}`]: optionIndex }, $inc: { slackChoiceRevision: 1 } }
	);
}

/** false when the choices changed or are already being submitted */
export async function lockChoices(
	conversationId: RunId,
	elicitationId: string,
	revision: number
): Promise<boolean> {
	const locked = await collections.mcpElicitations.updateOne(
		{
			conversationId,
			elicitationId,
			status: "pending",
			slackChoiceRevision: revision,
			slackSubmitting: { $ne: true },
		},
		{ $set: { slackSubmitting: true, slackShareAnswer: true } }
	);
	return locked.modifiedCount > 0;
}

export async function releaseChoices(conversationId: RunId, elicitationId: string) {
	await collections.mcpElicitations.updateOne(
		{ conversationId, elicitationId },
		{ $unset: { slackSubmitting: "" } }
	);
}

/** the client echoes this answer once accepted */
export async function shareAnswer(conversationId: RunId, elicitationId: string) {
	await collections.mcpElicitations.updateOne(
		{ conversationId, elicitationId, status: "pending" },
		{ $set: { slackShareAnswer: true } }
	);
}
