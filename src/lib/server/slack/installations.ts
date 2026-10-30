import { WebClient } from "@slack/web-api";
import { collections } from "$lib/server/database";
import { decryptSecret, encryptSecret } from "$lib/server/mcp/oauth/encryption";
import { slackConfig, type SlackConfig } from "./config";
import type { SlackInstallation } from "./types";

/** Bot scopes requested on install; keep in step with integrations/slack/manifest.json. */
export const SLACK_BOT_SCOPES = [
	"app_mentions:read",
	"chat:write",
	"reactions:write",
	"channels:history",
	"channels:read",
	"groups:history",
	"groups:read",
	"im:history",
	"im:read",
	"im:write",
	"users:read",
	"files:write",
	"files:read",
];

export interface SlackWorkspace {
	teamId: string;
	botToken: string;
	botUserId: string;
	botId?: string;
}

const quiet = { retryConfig: { retries: 0 }, timeout: 10000 };
let home:
	| { token: string; value: Promise<{ botUserId: string; botId?: string; appId: string }> }
	| undefined;
/** the home bot's identity, looked up once per token */
export function homeIdentity(settings: SlackConfig) {
	if (home?.token !== settings.botToken) {
		const value = (async () => {
			const client = new WebClient(settings.botToken, quiet);
			const auth = await client.auth.test();
			if (auth.team_id !== settings.teamId || !auth.user_id || !auth.bot_id)
				throw new Error("Slack bot token belongs to a different workspace.");
			const bot = await client.bots.info({ bot: auth.bot_id });
			if (!bot.bot?.app_id) throw new Error("Could not identify the Slack app.");
			return { botUserId: auth.user_id, botId: auth.bot_id, appId: bot.bot.app_id };
		})();
		value.catch(() => {
			if (home?.value === value) home = undefined;
		});
		home = { token: settings.botToken, value };
	}
	return home.value;
}

const cache = new Map<string, { until: number; value: Promise<SlackWorkspace | undefined> }>();

/** True when this deployment serves the workspace: the home one, or an enabled install. */
export async function slackInstalled(teamId: string, settings = slackConfig()): Promise<boolean> {
	if (!settings) return false;
	if (teamId === settings.teamId) return true;
	return !!(await installedWorkspace(settings, teamId));
}

/** Bot credentials for a served workspace, cached for 30 s so a disable or uninstall lands soon. */
export async function slackWorkspace(
	teamId: string,
	settings = slackConfig()
): Promise<SlackWorkspace | undefined> {
	if (!settings) return;
	if (teamId === settings.teamId) {
		const identity = await homeIdentity(settings);
		return { teamId, botToken: settings.botToken, ...identity };
	}
	return installedWorkspace(settings, teamId);
}

function installedWorkspace(settings: SlackConfig, teamId: string) {
	if (!settings.publicInstall) return Promise.resolve(undefined);
	const now = Date.now();
	const cached = cache.get(teamId);
	if (cached && cached.until > now) return cached.value;
	if (cache.size >= 1000)
		for (const [key, entry] of cache) if (entry.until <= now) cache.delete(key);
	const value = collections.slackInstallations
		.findOne({ _id: teamId, disabled: { $ne: true } })
		.then((row) => {
			const botToken = row && decryptSecret(row.botToken);
			return row && botToken ? { teamId, botToken, botUserId: row.botUserId } : undefined;
		});
	value.catch(() => cache.delete(teamId));
	cache.set(teamId, { until: now + 30_000, value });
	return value;
}

/** a client for routes that only call Slack, without resolving the bot's own identity */
export async function workspaceClient(
	teamId: string,
	settings = slackConfig()
): Promise<WebClient | undefined> {
	if (!settings) return;
	const token =
		teamId === settings.teamId
			? settings.botToken
			: (await installedWorkspace(settings, teamId))?.botToken;
	return token ? new WebClient(token, quiet) : undefined;
}

export async function saveInstallation(
	installation: Omit<SlackInstallation, "installedAt" | "updatedAt" | "disabled">
): Promise<void> {
	const now = new Date();
	await collections.slackInstallations.updateOne(
		{ _id: installation._id },
		{
			$set: { ...installation, botToken: encryptSecret(installation.botToken), updatedAt: now },
			$setOnInsert: { installedAt: now },
		},
		{ upsert: true }
	);
	cache.delete(installation._id);
}

/** Slack revoked the app: forget the token and stop polling that workspace's threads. */
export async function removeInstallation(teamId: string): Promise<void> {
	await collections.slackInstallations.deleteOne({ _id: teamId });
	await collections.slackThreads.updateMany(
		{ teamId, watching: true },
		{ $set: { watching: false } }
	);
	cache.delete(teamId);
}
