import { WebClient } from "@slack/web-api";
import { slackConfig } from "$lib/server/slack/config";
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
	const settings = slackConfig();
	if (!settings && (ticket || connections.length)) error(503, "Slack is unavailable.");
	const client = new WebClient(settings?.botToken, { retryConfig: { retries: 0 }, timeout: 10000 });
	const describe = async (teamId: string, userId: string) => {
		const [team, user] = await Promise.all([
			client.auth.test(),
			client.users.info({ user: userId }),
		]);
		if (!team.team || team.team_id !== teamId || !user.user || user.user.team_id !== teamId)
			error(503, "Could not verify Slack account details. Try again shortly.");
		return {
			workspaceName: team.team,
			displayName:
				user.user.profile?.display_name || user.user.real_name || user.user.name || userId,
		};
	};
	const slackNames = ticket ? await describe(ticket.teamId, ticket.slackUserId) : undefined;
	const namedConnections = await Promise.all(
		connections.map(async (connection) => ({
			...connection,
			...(await describe(connection.teamId, connection.slackUserId)),
		}))
	);
	return {
		username: locals.user.username,
		ticket: token,
		slackUser: ticket?.slackUserId,
		slackTeam: ticket?.teamId,
		connected: connections.length > 0,
		connections: namedConnections,
		slackNames,
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
