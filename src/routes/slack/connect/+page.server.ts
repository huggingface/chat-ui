import { error, fail, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { collections } from "$lib/server/database";
import { connectAccount, readConnectionLink, ConnectionError } from "$lib/server/slack/connections";
import { identity } from "$lib/server/slack/viewer/auth";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, setHeaders, cookies }) => {
	setHeaders({ "cache-control": "private, no-store", "referrer-policy": "same-origin" });
	if (!locals.user)
		redirect(303, `${base}/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	const token = url.searchParams.get("ticket");
	const ticket = token ? await readConnectionLink(token) : null;
	if (token && !ticket)
		error(400, "This connection link expired. Mention ML Intern again for a new link.");
	if (ticket) {
		const slack = identity({ cookies });
		if (!slack) redirect(303, `${base}/slack/view/login?connect=${token}`);
		if (slack.team !== ticket.teamId || slack.user !== ticket.slackUserId)
			error(
				403,
				"This link belongs to a different Slack account. Mention the bot yourself for a new link."
			);
	}
	const connections = await collections.slackConnections
		.find({ userId: locals.user._id })
		.project<{ _id: string; teamId: string; slackUserId: string }>({
			_id: 1,
			teamId: 1,
			slackUserId: 1,
		})
		.toArray();
	return {
		username: locals.user.username,
		ticket: token,
		slackUser: ticket?.slackUserId,
		slackTeam: ticket?.teamId,
		connected: connections.length > 0,
		connections,
	};
};
export const actions: Actions = {
	default: async ({ locals, request, url, cookies }) => {
		if (request.headers.get("origin") !== url.origin) error(403, "Invalid origin.");
		if (!locals.user) error(401, "Sign in to HuggingChat first.");
		const form = await request.formData();
		if (form.get("action") === "disconnect") {
			const connectionId = form.get("connectionId");
			await collections.slackConnections.deleteMany({
				userId: locals.user._id,
				...(typeof connectionId === "string" ? { _id: connectionId } : {}),
			});
			return { disconnected: true };
		}
		try {
			await connectAccount(
				String(form.get("ticket") ?? ""),
				locals.user,
				locals.sessionId,
				identity({ cookies })
			);
		} catch (e) {
			return fail(400, {
				error: e instanceof ConnectionError ? e.message : "Could not connect your account.",
			});
		}
		redirect(303, `${base}/slack/connect?connected=1`);
	},
};
