import { error } from "@sveltejs/kit";
import { randomUUID } from "node:crypto";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { resolveMlAssistantModel } from "$lib/server/mlAssistantModels";
import { generateConversationResponse } from "$lib/server/generation/conversationRequest";
import { threadLocals } from "./identity";
import type { User } from "$lib/types/User";
import type { Conversation } from "$lib/types/Conversation";
import type { SlackConfig } from "./config";
import type { SlackThread } from "./types";
import { linkedSessionId } from "./connections";
import { usdToMicroUsd } from "$lib/utils/mlBudget";

export async function ensureConversation(
	thread: SlackThread,
	user: User,
	settings: SlackConfig
): Promise<void> {
	if ((await collections.slackThreads.findOne({ _id: thread._id }))?.deletedAt)
		throw new Error("This Slack conversation was deleted. Start a new Slack thread.");
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
		_id: thread.conversationId,
		userId: user._id,
		...(thread.hfUserId ? { sessionId: linkedSessionId(thread) } : {}),
		model,
		title: "[Slack] New Chat",
		managedBy: {
			kind: "slack",
			continueUrl: `https://app.slack.com/client/${encodeURIComponent(thread.teamId)}/${encodeURIComponent(thread.channel)}/thread/${encodeURIComponent(thread.channel)}-${encodeURIComponent(thread.threadTs)}`,
		},
		preprompt: "",
		mlAssistant: true,
		rootMessageId: root.id,
		messages: [root],
		createdAt: now,
		updatedAt: now,
		mlBudget: {
			totalMicroUsd: usdToMicroUsd(thread.hfUserId ? 0 : settings.budgetUsd),
			spentMicroUsd: 0,
			reservations: [],
		},
	};
	await collections.conversations.updateOne(
		{ _id: conversation._id },
		{ $setOnInsert: conversation },
		{ upsert: true }
	);
	// Deletion can race initial creation. Never leave a resurrected history entry.
	if ((await collections.slackThreads.findOne({ _id: thread._id }))?.deletedAt) {
		await collections.conversations.deleteOne({ _id: thread.conversationId });
		throw new Error("This Slack conversation was deleted. Start a new Slack thread.");
	}
}

/** Consume the same response as the web UI. Persistence, guards, waits and asks stay in the harness. */
export async function runSlackTurn(
	thread: SlackThread,
	user: User,
	input: { text?: string; files?: File[]; resumeElicitationId?: string; retry?: boolean },
	resolvedLocals?: App.Locals
): Promise<void> {
	const conv = await collections.conversations.findOne({
		_id: thread.conversationId,
		userId: user._id,
	});
	if (!conv) throw new Error("Slack conversation no longer exists.");
	const latest = conv.messages[conv.messages.length - 1];
	const data = new FormData();
	data.set(
		"data",
		JSON.stringify({
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
		request: new Request("http://slack.internal/conversation", { method: "POST", body: data }),
		locals: resolvedLocals ?? (await threadLocals(thread, user)),
		params: { id: thread.conversationId.toHexString() },
		getClientAddress: () => "slack",
	});
	if (!response.ok) error(response.status, `ML Intern rejected this turn (${response.status}).`);
	const reader = response.body?.getReader();
	if (!reader) return;
	try {
		while (!(await reader.read()).done) {
			/* State is persisted by the shared runner. */
		}
	} finally {
		reader.releaseLock();
	}
}

/** Stop both a live producer and durable waits/questions; remote compute is left tracked. */
export async function stopSlackTurn(thread: SlackThread, user: User): Promise<void> {
	const { stopConversation } = await import("$lib/server/generation/stopConversation");
	await stopConversation({
		params: { id: thread.conversationId.toHexString() },
		locals: {
			user,
			sessionId: thread.hfUserId ? linkedSessionId(thread) : `slack-ml:${thread.teamId}`,
			isAdmin: false,
		},
		request: new Request("http://slack.internal/stop", { method: "POST" }),
	});
	const now = new Date();
	await collections.parkedCalls.updateMany(
		{ conversationId: thread.conversationId, status: "waiting" },
		{ $set: { status: "abandoned", abandonedReason: "Stopped from Slack", updatedAt: now } }
	);
	await collections.mcpElicitations.updateMany(
		{ conversationId: thread.conversationId, status: "pending" },
		{
			$set: {
				status: "resolved",
				action: "cancel",
				resolution: "aborted",
				resolvedAt: now,
				updatedAt: now,
				resume: {
					status: "abandoned",
					takenAt: now,
					attempts: 0,
					abandonedReason: "Stopped from Slack",
				},
			},
		}
	);
	const parked = await collections.turnStates.findOneAndUpdate(
		{ conversationId: thread.conversationId, status: { $in: ["waiting", "awaiting_input"] } },
		{ $set: { status: "failed", error: "Stopped from Slack", endedAt: now, updatedAt: now } },
		{ returnDocument: "after" }
	);
	if (parked.value) {
		await collections.abortedGenerations.deleteOne({
			conversationId: thread.conversationId,
			updatedAt: { $lte: now },
		});
		await collections.conversations.updateOne(
			{ _id: thread.conversationId, "messages.id": parked.value.messageId },
			{ $set: { "messages.$.interrupted": true, updatedAt: now } }
		);
	}
	await collections.slackThreads.updateOne(
		{ _id: thread._id },
		{ $set: { watching: true, updatedAt: now } }
	);
}

/** An owner's new request supersedes a pending assistant question, never a budget approval. */
export async function skipSlackQuestion(
	thread: SlackThread,
	user: User,
	messageId: string,
	inputId: string
): Promise<boolean> {
	const now = new Date();
	const result = await collections.mcpElicitations.findOneAndUpdate(
		{
			conversationId: thread.conversationId,
			"pending.kind": "ask",
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
				resume: {
					status: "abandoned",
					takenAt: now,
					attempts: 0,
					abandonedReason: "Continued with a new Slack message",
				},
			},
		},
		{ returnDocument: "after" }
	);
	if (!result.value) return false;
	await stopSlackTurn(thread, user);
	return true;
}
