import { eligibleParticipant } from "./access";
import { createHash, randomBytes } from "node:crypto";
import { OIDConfig } from "$lib/server/auth";
import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { config } from "$lib/server/config";
import type { SlackThread } from "./types";
import type { User } from "$lib/types/User";
import type { ViewerIdentity } from "./viewer/auth";
import { slackConfig } from "./config";
import { slackInstalled, workspaceClient } from "./installations";

export const connectionKey = (team: string, user: string, homeTeam = team) =>
	homeTeam === team ? `${team}:${user}` : `${team}:${homeTeam}:${user}`;

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
export async function createConnectionLink(
	teamId: string,
	slackUserId: string,
	source?: { userTeamId: string; channel: string }
): Promise<string> {
	const token = randomBytes(32).toString("base64url");
	// Keep outstanding links valid while bounding live tickets per account.
	await collections.slackLinks.deleteMany({ teamId, slackUserId, expiresAt: { $lte: new Date() } });
	if ((await collections.slackLinks.countDocuments({ teamId, slackUserId })) >= 5)
		throw new ConnectionError(
			"Use a recent connection link or wait ten minutes before requesting another."
		);
	await collections.slackLinks.insertOne({
		_id: hash(token),
		...source,
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
	const ticket = await collections.slackLinks.findOne({
		_id: hash(token),
		expiresAt: { $gt: new Date() },
	});
	return ticket && (await slackInstalled(ticket.teamId)) ? ticket : null;
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
		slackIdentity.team !== (ticket.userTeamId ?? ticket.teamId) ||
		slackIdentity.user !== ticket.slackUserId
	)
		throw new ConnectionError(
			"Sign in with the Slack account that requested this connection link."
		);
	if (ticket.userTeamId && ticket.userTeamId !== ticket.teamId) {
		const settings = slackConfig();
		const client = await workspaceClient(ticket.teamId);
		if (!settings || !client || !ticket.channel)
			throw new ConnectionError("Shared channel unavailable.");
		const participant = await eligibleParticipant(
			client,
			{ ...settings, teamId: ticket.teamId },
			ticket.slackUserId,
			ticket.channel
		);
		if (participant?.team_id !== ticket.userTeamId)
			throw new ConnectionError("You are no longer a member of this shared channel.");
	}
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
		{ _id: connectionKey(ticket.teamId, ticket.slackUserId, ticket.userTeamId) },
		{
			$set: {
				verifiedSlackIdentity: true,
				userTeamId: ticket.userTeamId ?? ticket.teamId,
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
