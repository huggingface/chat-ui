import { findUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { slackConfig } from "./config";
import type { SlackThread } from "./types";
import { connectionKey, ConnectionError, chatOrigin } from "./links";
export const linkedSessionId = (thread: SlackThread) => `slack-user:${thread._id}`;
export function parseLinkedSessionId(id?: string): string | undefined {
	return id?.startsWith("slack-user:") ? id.slice("slack-user:".length) : undefined;
}
/** Resolve the pinned owner, never the current contributor or the most recent browser session. */
export async function connectedLocals(thread: SlackThread): Promise<App.Locals> {
	const settings = slackConfig();
	if (settings?.accountMode !== "user" || settings.teamId !== thread.teamId)
		throw new ConnectionError("This Slack account connection is disabled.");
	const connection = await collections.slackConnections.findOne({
		_id: connectionKey(thread.teamId, thread.owner),
	});
	if (
		!thread.hfUserId ||
		!connection?.verifiedSlackIdentity ||
		!connection.userId.equals(thread.hfUserId)
	)
		throw new ConnectionError(
			"The session owner must reconnect the original Hugging Face account."
		);
	const session = await collections.sessions.findOne({
		sessionId: connection.sessionId,
		userId: thread.hfUserId,
		expiresAt: { $gt: new Date() },
	});
	if (!session) throw new ConnectionError("The session owner must reconnect Hugging Face.");

	const result = await findUser(connection.sessionId, undefined, new URL(chatOrigin()));
	if (
		result.invalidateSession ||
		!result.user?._id.equals(thread.hfUserId) ||
		!result.oauth?.token ||
		result.oauth.token.expiresAt <= new Date()
	)
		throw new ConnectionError("The session owner must reconnect Hugging Face.");
	await collections.sessions.updateOne(
		{ sessionId: connection.sessionId, userId: thread.hfUserId, expiresAt: { $gt: new Date() } },
		{ $max: { expiresAt: new Date(Date.now() + 14 * 86400_000) }, $set: { updatedAt: new Date() } }
	);
	const preferences = await collections.settings.findOne({ userId: thread.hfUserId });
	return {
		user: result.user,
		sessionId: linkedSessionId(thread),
		isAdmin: false,
		token: result.oauth.token.value,
		publishNamespace: result.user.username,
		billingOrganization: preferences?.billingOrganization,
		billingResourceGroup: preferences?.billingResourceGroup,
	};
}
