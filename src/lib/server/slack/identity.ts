import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { collections } from "$lib/server/database";
import type { User } from "$lib/types/User";
import { slackConfig, type SlackConfig } from "./config";

/** Separate application identity: Slack tasks never appear in the token owner's private chats. */
export async function provisionSlackIdentity(settings: SlackConfig): Promise<User> {
	const response = await fetch("https://huggingface.co/api/whoami-v2", {
		headers: { Authorization: `Bearer ${settings.hfToken}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error("Slack ML HF token could not be validated.");
	const account = z.object({ name: z.string().min(1) }).parse(await response.json());
	const now = new Date();
	const user: User = {
		_id: new ObjectId(
			createHash("sha256").update(`slack-ml:${settings.teamId}`).digest("hex").slice(0, 24)
		),
		hfUserId: `slack-ml:${settings.teamId}`,
		slackBotTeamId: settings.teamId,
		username: account.name,
		name: "ML Intern Bot",
		avatarUrl: undefined,
		createdAt: now,
		updatedAt: now,
	};
	await collections.users.updateOne(
		{ _id: user._id },
		{
			$set: { username: user.username, slackBotTeamId: settings.teamId, updatedAt: now },
			$setOnInsert: { hfUserId: user.hfUserId, name: user.name, createdAt: now },
		},
		{ upsert: true }
	);
	return user;
}

/** Resolve the current server secret on every resume; never persist HF tokens with a thread. */
export function slackLocals(user: User): App.Locals {
	const settings = slackConfig();
	if (!settings || settings.teamId !== user.slackBotTeamId) {
		throw new Error("This Slack ML installation is disabled or belongs to another workspace.");
	}
	return {
		user,
		sessionId: `slack-ml:${settings.teamId}`,
		isAdmin: false,
		token: settings.hfToken,
		publishNamespace: settings.publishNamespace,
		billingOrganization: settings.billingOrganization,
		billingResourceGroup: settings.billingResourceGroup,
	};
}
