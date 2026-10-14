import { error, fail, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { connectAccount, readConnectionLink, ConnectionError } from "$lib/server/slack/connections";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	setHeaders({ "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
	if (!locals.user)
		redirect(303, `${base}/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const token = url.searchParams.get("ticket");
	const ticket = token ? await readConnectionLink(token) : null;
	if (token && !ticket)
		error(400, "This connection link expired. Mention ML Intern again for a new link.");
	const connected = await collections.slackConnections.countDocuments({ userId: locals.user._id });
	return {
		username: locals.user.username,
		ticket: token,
		slackUser: ticket?.slackUserId,
		slackTeam: ticket?.teamId,
		connected: connected > 0,
	};
};
export const actions: Actions = {
	default: async ({ locals, request, url }) => {
		if (request.headers.get("origin") !== url.origin) error(403, "Invalid origin.");
		if (!locals.user) error(401, "Sign in to HuggingChat first.");
		const form = await request.formData();
		if (form.get("action") === "disconnect") {
			await collections.slackConnections.deleteMany({ userId: locals.user._id });
			return { disconnected: true };
		}
		try {
			await connectAccount(String(form.get("ticket") ?? ""), locals.user, locals.sessionId);
		} catch (e) {
			return fail(400, {
				error: e instanceof ConnectionError ? e.message : "Could not connect your account.",
			});
		}
		redirect(303, `${base}/slack/connect?connected=1`);
	},
};
