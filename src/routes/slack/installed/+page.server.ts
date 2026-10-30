import { z } from "zod";
import type { PageServerLoad } from "./$types";
import { installedCookie } from "$lib/server/slack/install";
import { verify, viewerConfig } from "$lib/server/slack/viewer/auth";

export const load: PageServerLoad = async ({ url, cookies, setHeaders }) => {
	setHeaders({ "cache-control": "private, no-store" });
	const viewer = viewerConfig();
	const installed = z
		.object({
			teamId: z.string().regex(/^T[A-Z0-9]+$/),
			teamName: z.string(),
			appId: z.string().regex(/^A[A-Z0-9]+$/),
			expires: z.number(),
		})
		.safeParse(viewer && verify(cookies.get(installedCookie), viewer.secret));
	if (!installed.success || installed.data.expires < Date.now())
		return { cancelled: url.searchParams.has("cancelled"), installed: undefined };
	const { teamId, teamName, appId } = installed.data;
	return {
		cancelled: false,
		installed: {
			teamName,
			slackUrl: `https://slack.com/app_redirect?app=${appId}&team=${teamId}`,
		},
	};
};
