import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import { slackConfig } from "$lib/server/slack/config";
import {
	completeInstall,
	installCookie,
	installedCookie,
	InstallError,
} from "$lib/server/slack/install";
import { cookieOptions, sign, viewerConfig } from "$lib/server/slack/viewer/auth";

export const GET: RequestHandler = async ({ url, cookies }) => {
	let settings;
	try {
		settings = slackConfig();
	} catch {
		error(503, "Slack is unavailable.");
	}
	const viewer = viewerConfig();
	if (!settings?.publicInstall || !viewer) error(404, "Not found");
	const expected = cookies.get(installCookie);
	cookies.delete(installCookie, cookieOptions);
	if (url.searchParams.get("error")) redirect(303, `${base}/slack/installed?cancelled=1`);
	// Installs Slack starts itself, such as after an admin approves a request, carry no state.
	// Nothing here signs anyone in: the code only installs the workspace that approved it.
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	if (!code || (state && state !== expected))
		error(400, "This install link expired. Open the install link again.");
	let installed;
	try {
		installed = await completeInstall(settings, code);
	} catch (e) {
		error(
			e instanceof InstallError ? 400 : 502,
			e instanceof InstallError ? e.message : "Slack install failed. Try again."
		);
	}
	cookies.set(
		installedCookie,
		sign({ ...installed, expires: Date.now() + 600_000 }, viewer.secret),
		{ ...cookieOptions, maxAge: 600 }
	);
	redirect(303, `${base}/slack/installed`);
};
