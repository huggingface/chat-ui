import { collections } from "$lib/server/database";
import {
	discardRunSession,
	openRunSession,
	sendTurn,
	stopRun,
	supersedeQuestion,
	type TurnInput,
} from "$lib/server/mlRun";
import type { ManagedBy } from "$lib/types/Conversation";
import type { User } from "$lib/types/User";
import { threadLocals } from "./identity";
import type { SlackConfig } from "./config";
import type { SlackThread } from "./types";
import { linkedSessionId } from "./connections";

export function slackManagedBy(thread: Pick<SlackThread, "teamId" | "channel" | "threadTs">) {
	const [team, channel, ts] = [thread.teamId, thread.channel, thread.threadTs].map(
		encodeURIComponent
	);
	return {
		kind: "slack",
		continueUrl: `https://app.slack.com/client/${team}/${channel}/thread/${channel}-${ts}`,
	} satisfies ManagedBy;
}

const stopLocals = (thread: SlackThread, user: User): App.Locals => ({
	user,
	sessionId: thread.hfUserId ? linkedSessionId(thread) : `slack-ml:${thread.teamId}`,
	isAdmin: false,
});

export async function ensureConversation(
	thread: SlackThread,
	user: User,
	settings: SlackConfig
): Promise<void> {
	if ((await collections.slackThreads.findOne({ _id: thread._id }))?.deletedAt)
		throw new Error("This Slack conversation was deleted. Start a new Slack thread.");
	await openRunSession({
		conversationId: thread.conversationId,
		user,
		sessionId: thread.hfUserId ? linkedSessionId(thread) : undefined,
		managedBy: slackManagedBy(thread),
		title: "[Slack] New Chat",
		budgetUsd: thread.hfUserId ? 0 : settings.budgetUsd,
	});
	// Deletion can race initial creation. Never leave a resurrected history entry.
	if ((await collections.slackThreads.findOne({ _id: thread._id }))?.deletedAt) {
		await discardRunSession(thread.conversationId);
		throw new Error("This Slack conversation was deleted. Start a new Slack thread.");
	}
}

export async function runSlackTurn(
	thread: SlackThread,
	user: User,
	input: TurnInput,
	resolvedLocals?: App.Locals,
	onMcpUnavailable?: () => Promise<void>
): Promise<void> {
	if (thread.hfUserId && !thread.hfUserId.equals(user._id))
		throw new Error("Slack session owner does not match the connected user.");
	await sendTurn({
		conversationId: thread.conversationId,
		locals: resolvedLocals ?? (await threadLocals(thread, user)),
		client: "slack",
		input,
		personalTools: !!thread.hfUserId,
		onMcpUnavailable,
	});
}

export async function stopSlackTurn(thread: SlackThread, user: User): Promise<void> {
	await stopRun({
		conversationId: thread.conversationId,
		locals: stopLocals(thread, user),
		reason: "Stopped from Slack",
	});
	await collections.slackThreads.updateOne(
		{ _id: thread._id },
		{ $set: { watching: true, updatedAt: new Date() } }
	);
}

export async function skipSlackQuestion(
	thread: SlackThread,
	user: User,
	messageId: string,
	inputId: string
): Promise<boolean> {
	const outcome = await supersedeQuestion({
		conversationId: thread.conversationId,
		messageId,
		inputId,
		reason: "Continued with a new Slack message",
	});
	if (outcome === "superseded") await stopSlackTurn(thread, user);
	return outcome !== "none";
}
