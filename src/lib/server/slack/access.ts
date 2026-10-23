import type { WebClient } from "@slack/web-api";
import type { SlackConfig } from "./config";
import { isWorkspaceMember } from "./context";

/** Validate against the installing workspace's token, never an event's claimed home team. */
export async function eligibleParticipant(
	client: WebClient,
	settings: SlackConfig,
	userId: string,
	channelId: string
) {
	if (settings.allowedChannels.length && !settings.allowedChannels.includes(channelId)) return;
	const [{ user }, { channel }] = await Promise.all([
		client.users.info({ user: userId }),
		client.conversations.info({ channel: channelId }),
	]);
	if (!user || !channel) return;
	if (channel.is_ext_shared && settings.accountMode !== "user") return;
	if (isWorkspaceMember(user, settings.teamId) && !channel.is_ext_shared) return user;
	if (
		settings.accountMode !== "user" ||
		!channel.is_ext_shared ||
		channelId.startsWith("D") ||
		channel.is_im ||
		channel.is_mpim ||
		!user.team_id ||
		user.is_bot ||
		user.deleted ||
		user.is_restricted ||
		user.is_ultra_restricted ||
		(user.team_id !== settings.teamId &&
			(user.is_restricted !== false || user.is_ultra_restricted !== false)) ||
		user.is_stranger
	)
		return;
	// users.info also returns strangers mentioned in a shared channel. Require
	// actual membership of this particular channel, including paginated results.
	let cursor: string | undefined;
	do {
		const page = await client.conversations.members({ channel: channelId, limit: 1000, cursor });
		if (page.members?.includes(userId)) return user;
		cursor = page.response_metadata?.next_cursor || undefined;
	} while (cursor);
}
