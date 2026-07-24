import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { config } from "$lib/server/config";
import { logger } from "$lib/server/logger";
import { discoverServerOAuth } from "$lib/server/mcp/oauth/discover";
import { oauthCallbackUri, oauthClientMetadataUri } from "$lib/server/mcp/oauth/redirect";
import { createOAuthConnection, publicOAuthState } from "$lib/server/mcp/oauth/connections";

const Body = z.object({
	url: z.string().url(),
});

export const POST: RequestHandler = async ({ request, url, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	let redirectUri: string;
	try {
		redirectUri = oauthCallbackUri(url);
	} catch (e) {
		return error(500, e instanceof Error ? e.message : "Invalid OAuth callback configuration");
	}

	try {
		const result = await discoverServerOAuth(parsed.url, {
			redirectUri,
			clientMetadataUri: oauthClientMetadataUri(url),
			appName: config.PUBLIC_APP_NAME || "chat-ui",
		});

		if (!result.requiresAuth || !result.resource || !result.asMetadata) {
			return json({
				requiresAuth: false,
				probeStatus: result.probeStatus,
			});
		}

		const connection = await createOAuthConnection(locals, {
			serverUrl: parsed.url,
			resource: result.resource,
			resourceMetadataUrl: result.resourceMetadataUrl,
			asMetadata: result.asMetadata,
			clientInfo: result.clientInfo,
			registrationMethod: result.registrationMethod,
			requestedScope: result.requestedScope,
		});
		return json({
			requiresAuth: true,
			connection: publicOAuthState(connection),
			probeStatus: result.probeStatus,
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Discovery failed";
		logger.warn({ err: msg, url: parsed.url }, "[mcp-oauth] discovery failed");
		return error(502, msg);
	}
};
