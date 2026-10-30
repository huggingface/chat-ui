import { WebClient } from "@slack/web-api";
import { base } from "$app/paths";
import { logger } from "$lib/server/logger";
import type { SlackConfig } from "./config";
import { chatOrigin } from "./links";
import { homeIdentity, saveInstallation, SLACK_BOT_SCOPES } from "./installations";

export const installCookie = "__Secure-ml-slack-install";
export const installedCookie = "__Secure-ml-slack-installed";
export class InstallError extends Error {}

const redirectUri = () => `${chatOrigin()}${base}/slack/install/callback`;

export function installUrl(settings: SlackConfig, state: string): string {
	const url = new URL("https://slack.com/oauth/v2/authorize");
	url.searchParams.set("client_id", settings.clientId ?? "");
	url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
	url.searchParams.set("redirect_uri", redirectUri());
	url.searchParams.set("state", state);
	return url.toString();
}

/** Exchange Slack's code for the workspace's bot token, store it, and greet the installer. */
export async function completeInstall(
	settings: SlackConfig,
	code: string
): Promise<{ teamId: string; teamName: string; appId: string }> {
	const access = await new WebClient(undefined, {
		retryConfig: { retries: 0 },
		timeout: 10000,
	}).oauth.v2
		.access({
			client_id: settings.clientId ?? "",
			client_secret: settings.clientSecret ?? "",
			code,
			redirect_uri: redirectUri(),
		})
		.catch(() => {
			throw new InstallError(
				"Slack did not accept this install. Start again from the install link."
			);
		});
	const teamId = access.team?.id;
	if (access.is_enterprise_install || !teamId)
		throw new InstallError(
			"Organization-wide Enterprise Grid installs are not supported yet. Install ML Intern in a single workspace instead."
		);
	if (
		access.token_type !== "bot" ||
		!access.access_token?.startsWith("xoxb-") ||
		!access.bot_user_id ||
		!access.authed_user?.id
	)
		throw new InstallError(
			"Slack returned an incomplete install. Start again from the install link."
		);
	const home = await homeIdentity(settings);
	if (access.app_id !== home.appId) {
		logger.error("[slack] SLACK_ML_CLIENT_ID belongs to a different app than the bot token");
		throw new InstallError("This server is misconfigured for Slack installs.");
	}
	const scopes = access.scope?.split(",") ?? [];
	if (SLACK_BOT_SCOPES.some((scope) => !scopes.includes(scope)))
		throw new InstallError(
			"Slack granted fewer permissions than ML Intern needs. Ask a workspace admin to approve all of them, then install again."
		);
	const teamName = access.team?.name || teamId;
	// The home workspace keeps using the deployment's own token.
	if (teamId !== settings.teamId)
		await saveInstallation({
			_id: teamId,
			teamName,
			appId: home.appId,
			botToken: access.access_token,
			botUserId: access.bot_user_id,
			scopes,
			installedBy: access.authed_user.id,
		});
	logger.info("[slack] Installed in a workspace");
	await new WebClient(access.access_token, { retryConfig: { retries: 0 }, timeout: 10000 }).chat
		.postMessage({
			channel: access.authed_user.id,
			text: welcomeText(access.bot_user_id),
			unfurl_links: false,
		})
		.catch(() => logger.warn("[slack] Could not send the install welcome message"));
	return { teamId, teamName, appId: home.appId };
}

export function welcomeText(botUserId: string): string {
	return [
		"Thanks for adding ML Intern! To get started:",
		`1. Add <@${botUserId}> to a channel from its details → Agents & apps, then mention me with a task.`,
		"2. The first time, I'll send you a private link to connect your Hugging Face account. I work with your account, so inference is billed to you, and compute jobs only run on a budget you approve.",
		"You can also message me here directly. Everyone in your workspace connects their own account the same way.",
	].join("\n");
}
