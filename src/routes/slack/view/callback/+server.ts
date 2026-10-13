import { z } from "zod";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import {
	cookieOptions,
	flowCookie,
	sessionCookie,
	oidcClient,
	sign,
	verify,
	viewerConfig,
} from "$lib/server/slack/viewer/auth";
import { slackConfig } from "$lib/server/slack/config";
export const GET: RequestHandler = async ({ url, cookies }) => {
	const settings = viewerConfig(),
		slack = slackConfig();
	if (!settings || !slack) error(503, "Slack viewer is not configured.");
	const flow = z
		.object({
			state: z.string(),
			nonce: z.string(),
			target: z.string().regex(/^[a-f0-9]{24}$/),
			expires: z.number(),
		})
		.safeParse(verify(cookies.get(flowCookie), settings.secret));
	cookies.delete(flowCookie, cookieOptions);
	if (
		!flow.success ||
		flow.data.expires < Date.now() ||
		url.searchParams.get("state") !== flow.data.state
	)
		error(400, "Sign-in expired or invalid. Start again.");
	let user: string, team: string;
	try {
		const client = await oidcClient();
		const tokens = await client.callback(
			`${settings.origin}${base}/slack/view/callback`,
			client.callbackParams(url.toString()),
			{ state: flow.data.state, nonce: flow.data.nonce }
		);
		const claims = z
			.object({
				"https://slack.com/user_id": z.string().regex(/^U[A-Z0-9]+$/),
				"https://slack.com/team_id": z.string().regex(/^T[A-Z0-9]+$/),
			})
			.parse(tokens.claims());
		user = claims["https://slack.com/user_id"];
		team = claims["https://slack.com/team_id"];
	} catch {
		error(401, "Slack sign-in failed. Start again.");
	}
	if (team !== slack.teamId) error(403, "Sign in with the bot's Slack workspace.");
	cookies.set(sessionCookie, sign({ user, team, expires: Date.now() + 3600000 }, settings.secret), {
		...cookieOptions,
		maxAge: 3600,
	});
	redirect(303, `${base}/slack/view/${flow.data.target}`);
};
