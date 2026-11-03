import { z } from "zod";
import { config } from "$lib/server/config";

/** Sign in with Slack settings, or undefined when they are missing or unsafe */
export function viewerConfig() {
	const parsed = z
		.object({
			origin: z.string().url(),
			clientId: z.string().min(1),
			clientSecret: z.string().min(1),
			secret: z.string().min(32),
		})
		.safeParse({
			origin: config.SLACK_ML_VIEWER_ORIGIN,
			clientId: config.SLACK_ML_VIEWER_CLIENT_ID,
			clientSecret: config.SLACK_ML_VIEWER_CLIENT_SECRET,
			secret: config.SLACK_ML_VIEWER_SESSION_SECRET,
		});
	if (!parsed.success) return;
	const url = new URL(parsed.data.origin);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		return;
	return { ...parsed.data, origin: url.origin };
}
