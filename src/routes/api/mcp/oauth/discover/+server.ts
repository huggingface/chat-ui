import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import { base } from "$app/paths";
import type { RequestHandler } from "./$types";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { discoverServerOAuth } from "$lib/server/mcp/oauth/discover";

const Body = z.object({
	url: z.string().url(),
});

export const POST: RequestHandler = async ({ request, url }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	const origin = config.PUBLIC_ORIGIN || url.origin;
	const redirectUri = `${origin}${base}/api/mcp/oauth/callback`;

	try {
		const result = await discoverServerOAuth(parsed.url, {
			redirectUri,
			appName: config.PUBLIC_APP_NAME || "chat-ui",
		});

		return json({
			requiresAuth: result.requiresAuth,
			resource: result.resource,
			resourceMetadataUrl: result.resourceMetadataUrl,
			asMetadata: result.asMetadata,
			clientInfo: result.clientInfo,
			supportsDcr: result.supportsDcr,
			probeStatus: result.probeStatus,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Discovery failed";
		logger.warn({ err: msg, url: parsed.url }, "[mcp-oauth] discovery failed");
		return error(502, msg);
	}
};
