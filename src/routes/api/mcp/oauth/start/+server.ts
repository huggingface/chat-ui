import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import { randomUUID } from "crypto";
import type { RequestHandler } from "./$types";
import { dev } from "$app/environment";
import { base } from "$app/paths";
import { config } from "$lib/server/config";
import { buildAuthorizationUrl } from "$lib/server/mcp/oauth/exchange";
import {
	FLOW_COOKIE_NAME,
	FLOW_TTL_MS,
	newFlowId,
	signFlowCookie,
} from "$lib/server/mcp/oauth/state";
import { oauthCallbackUri, safeLocalReturnPath } from "$lib/server/mcp/oauth/redirect";
import {
	assertSafeOAuthUrl,
	parseAuthorizationServerMetadata,
	parseClientInformation,
} from "$lib/server/mcp/oauth/validation";

const Body = z.object({
	resource: z.string().url(),
	asMetadata: z.record(z.string(), z.unknown()),
	clientInfo: z.record(z.string(), z.unknown()),
	popupMode: z.boolean().default(true),
	redirectNext: z.string().optional(),
	scope: z.string().optional(),
});

const sameSite = "lax" as const;
const secure = !(dev || config.ALLOW_INSECURE_COOKIES === "true");

export const POST: RequestHandler = async ({ request, url, cookies, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	let asMetadata;
	let clientInfo;
	let redirectUri: string;
	try {
		asMetadata = parseAuthorizationServerMetadata(parsed.asMetadata);
		clientInfo = parseClientInformation(parsed.clientInfo);
		assertSafeOAuthUrl(parsed.resource, "MCP resource");
		redirectUri = oauthCallbackUri(url);
		if (clientInfo.redirect_uris.length > 0 && !clientInfo.redirect_uris.includes(redirectUri)) {
			return error(400, "OAuth client is not registered for the canonical redirect URI");
		}
		clientInfo = { ...clientInfo, redirect_uris: [redirectUri] };
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid OAuth configuration");
	}

	const flowId = newFlowId();
	const expectedState = randomUUID();

	let authorizationUrl: URL;
	let codeVerifier: string;
	try {
		const built = await buildAuthorizationUrl({
			asMetadata,
			clientInfo,
			redirectUri,
			resource: parsed.resource,
			state: expectedState,
			scope: parsed.scope,
		});
		authorizationUrl = built.authorizationUrl;
		codeVerifier = built.codeVerifier;
	} catch (e) {
		return error(502, e instanceof Error ? e.message : "Failed to build authorization URL");
	}

	let cookieValue: string;
	try {
		cookieValue = signFlowCookie(
			{
				flowId,
				verifier: codeVerifier,
				expectedState,
				asMetadata,
				clientInfo,
				resource: parsed.resource,
				redirectUri,
				popupMode: parsed.popupMode,
				redirectNext: parsed.redirectNext ? safeLocalReturnPath(parsed.redirectNext) : undefined,
				expiresAt: Date.now() + FLOW_TTL_MS,
			},
			locals.sessionId
		);
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid OAuth flow state");
	}

	cookies.set(`${FLOW_COOKIE_NAME}-${flowId}`, cookieValue, {
		path: `${base}/api/mcp/oauth`,
		httpOnly: true,
		sameSite,
		secure,
		maxAge: Math.floor(FLOW_TTL_MS / 1000),
	});

	return json({ authUrl: authorizationUrl.toString(), flowId });
};
