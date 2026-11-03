import { randomBytes } from "node:crypto";
import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { slackConfig } from "$lib/server/slack/config";
import { installCookie, installUrl } from "$lib/server/slack/install";
import { cookieOptions } from "$lib/server/slack/viewer/auth";

/** The shareable "Add to Slack" link: straight to Slack's consent screen. */
export const GET: RequestHandler = async ({ cookies }) => {
	let settings;
	try {
		settings = slackConfig();
	} catch {
		error(503, "Slack is unavailable.");
	}
	if (!settings?.publicInstall) error(404, "Not found");
	const state = randomBytes(32).toString("base64url");
	cookies.set(installCookie, state, { ...cookieOptions, maxAge: 600 });
	redirect(302, installUrl(settings, state));
};
