import { readConnectionLink } from "$lib/server/slack/links";
import { randomBytes } from "node:crypto";
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import {
	cookieOptions,
	flowCookie,
	oidcClient,
	sign,
	viewerConfig,
} from "$lib/server/slack/viewer/auth";
import { slackConfig } from "$lib/server/slack/config";
export const GET: RequestHandler = async ({ url, cookies }) => {
	const settings = viewerConfig(),
		slack = slackConfig();
	if (!settings || !slack) error(503, "Slack viewer is not configured.");
	const connect = url.searchParams.get("connect");
	const target = url.searchParams.get("session");
	if (connect ? !/^[\w-]{43}$/.test(connect) : !target || !/^[a-f0-9]{24}$/.test(target))
		error(400, "Invalid session.");
	const ticket = connect ? await readConnectionLink(connect) : null;
	if (connect && !ticket) error(400, "Connection link expired. Mention the bot again.");
	const loginTeam = ticket?.userTeamId ?? slack.teamId;
	const state = randomBytes(32).toString("base64url"),
		nonce = randomBytes(32).toString("base64url");
	cookies.set(
		flowCookie,
		sign({ state, nonce, target, connect, expires: Date.now() + 600000 }, settings.secret),
		{ ...cookieOptions, maxAge: 600 }
	);
	redirect(
		302,
		(await oidcClient()).authorizationUrl({ scope: "openid", state, nonce, team: loginTeam })
	);
};
