import { createHash, randomBytes } from "node:crypto";
import { OIDConfig } from "$lib/server/auth";
import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import type { SlackThread } from "./types";
import type { User } from "$lib/types/User";
import type { ViewerIdentity } from "./viewer/auth";
import { slackConfig } from "./config";

export const connectionKey = (team: string, user: string) => `${team}:${user}`;
export const linkedSessionId = (thread: SlackThread) => `slack-user:${thread._id}`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function chatOrigin(): string {
	if (new URL(OIDConfig.PROVIDER_URL).origin !== "https://huggingface.co")
		throw new Error("User-account Slack mode requires Hugging Face as the login provider.");
	const url = new URL(config.PUBLIC_ORIGIN);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error("User-account Slack mode requires an HTTPS PUBLIC_ORIGIN without a path.");
	return url.origin;
}
export function chatLink(thread: SlackThread): string | undefined {
	try {
		return thread.hfUserId
			? `${chatOrigin()}${base}/conversation/${thread.conversationId}`
			: undefined;
	} catch {
		return undefined;
	}
}
/** Sent ephemerally to the Slack user, never placed in a shared thread or log. */
export async function createConnectionLink(teamId: string, slackUserId: string): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	// Keep only the newest link per Slack account, preventing unbounded live tickets.
	await collections.slackLinks.deleteMany({ teamId, slackUserId });
	await collections.slackLinks.insertOne({
		_id: hash(token),
		teamId,
		slackUserId,
		expiresAt: new Date(Date.now() + 10 * 60_000),
	});
	return `${chatOrigin()}${base}/slack/connect?ticket=${token}`;
}
export async function readConnectionLink(token: string) {
	if (!/^[\w-]{43}$/.test(token)) return null;
	const settings = slackConfig();
	if (settings?.accountMode !== "user") return null;
	return collections.slackLinks.findOne({
		_id: hash(token),
		teamId: settings.teamId,
		expiresAt: { $gt: new Date() },
	});
}
export class ConnectionError extends Error {}

export async function connectAccount(
	token: string,
	user: User,
	sessionId: string,
	slackIdentity: ViewerIdentity | undefined
) {
	const ticket = await readConnectionLink(token);
	if (!ticket)
		throw new ConnectionError(
			"This connection link has expired. Mention the bot again for a new link."
		);
	if (
		!slackIdentity ||
		slackIdentity.expires <= Date.now() ||
		slackIdentity.team !== ticket.teamId ||
		slackIdentity.user !== ticket.slackUserId
	)
		throw new ConnectionError(
			"Sign in with the Slack account that requested this connection link."
		);
	const session = await collections.sessions.findOne({
		sessionId,
		userId: user._id,
		expiresAt: { $gt: new Date() },
	});
	if (!session?.oauth?.token || session.oauth.token.expiresAt <= new Date())
		throw new ConnectionError("Sign in to HuggingChat with Hugging Face again before connecting.");
	// The link is single-use, including when two browsers submit concurrently.
	const consumed = await collections.slackLinks.deleteOne({
		_id: ticket._id,
		expiresAt: { $gt: new Date() },
	});
	if (!consumed.deletedCount) throw new ConnectionError("This connection link was already used.");
	await collections.slackConnections.updateOne(
		{ _id: connectionKey(ticket.teamId, ticket.slackUserId) },
		{
			$set: {
				verifiedSlackIdentity: true,
				teamId: ticket.teamId,
				slackUserId: ticket.slackUserId,
				userId: user._id,
				sessionId,
				updatedAt: new Date(),
			},
		},
		{ upsert: true }
	);
}
/** Resolve the pinned owner, never the current contributor or the most recent browser session. */
export async function connectedLocals(thread: SlackThread): Promise<App.Locals> {
	const settings = slackConfig();
	if (settings?.accountMode !== "user" || settings.teamId !== thread.teamId)
		throw new Error("This Slack account connection is disabled.");
	const connection = await collections.slackConnections.findOne({
		_id: connectionKey(thread.teamId, thread.owner),
	});
	if (
		!thread.hfUserId ||
		!connection?.verifiedSlackIdentity ||
		!connection.userId.equals(thread.hfUserId)
	)
		throw new Error("The session owner must reconnect the original Hugging Face account.");
	const session = await collections.sessions.findOne({
		sessionId: connection.sessionId,
		userId: thread.hfUserId,
		expiresAt: { $gt: new Date() },
	});
	if (!session) throw new Error("The session owner must reconnect Hugging Face.");
	const { findUser } = await import("$lib/server/auth");
	const result = await findUser(connection.sessionId, undefined, new URL(chatOrigin()));
	if (
		result.invalidateSession ||
		!result.user?._id.equals(thread.hfUserId) ||
		!result.oauth?.token ||
		result.oauth.token.expiresAt <= new Date()
	)
		throw new Error("The session owner must reconnect Hugging Face.");
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
