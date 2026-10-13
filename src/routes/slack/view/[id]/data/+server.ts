import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { authorizedThread, viewerConfig } from "$lib/server/slack/viewer/auth";
import { conversationView, scrub } from "$lib/server/slack/viewer/data";
import { slackConfig } from "$lib/server/slack/config";
import { collections } from "$lib/server/database";
export const GET: RequestHandler = async (event) => {
	const thread = await authorizedThread(event);
	const conv = await collections.conversations.findOne({ _id: thread.conversationId });
	if (!conv) error(404, "Session not found.");
	const settings = slackConfig(),
		viewer = viewerConfig();
	const secrets = [
		settings?.hfToken,
		settings?.botToken,
		settings?.appToken,
		viewer?.clientSecret,
		viewer?.secret,
	].filter((s): s is string => !!s);
	const state = await collections.turnStates.findOne(
		{ conversationId: conv._id },
		{
			sort: { updatedAt: -1 },
			projection: { _id: 0, status: 1, waitReason: 1, waitUntil: 1, updatedAt: 1, error: 1 },
		}
	);
	const generation = await collections.generations.findOne(
		{ conversationId: conv._id },
		{
			sort: { createdAt: -1 },
			projection: { _id: 0, status: 1, startedAt: 1, lastHeartbeatAt: 1, updatedAt: 1 },
		}
	);
	return json({
		...conversationView(conv, secrets),
		state: scrub(state, secrets),
		generation: scrub(generation, secrets),
		slackUrl: `https://app.slack.com/client/${thread.teamId}/${thread.channel}/thread/${thread.channel}-${thread.threadTs}`,
	});
};
