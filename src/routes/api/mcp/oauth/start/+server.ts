import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import { base } from "$app/paths";
import { randomUUID } from "crypto";
import type { RequestHandler } from "./$types";
import { config } from "$lib/server/config";
import { dev } from "$app/environment";
import { buildAuthorizationUrl } from "$lib/server/mcp/oauth/exchange";
import {
	FLOW_COOKIE_NAME,
	FLOW_TTL_MS,
	newFlowId,
	signFlowCookie,
} from "$lib/server/mcp/oauth/state";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const Body = z.object({
	resource: z.string().url(),
	asMetadata: z.record(z.string(), z.unknown()),
	clientInfo: z.record(z.string(), z.unknown()),
	popupMode: z.boolean().default(true),
	redirectNext: z.string().optional(),
	scope: z.string().optional(),
});

const sameSite = config.ALLOW_INSECURE_COOKIES === "true" || dev ? "lax" : ("none" as const);
const secure = !(dev || config.ALLOW_INSECURE_COOKIES === "true");

export const POST: RequestHandler = async ({ request, url, cookies }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	const asMetadata = parsed.asMetadata as unknown as AuthorizationServerMetadata;
	const clientInfo = parsed.clientInfo as unknown as OAuthClientInformationFull;

	if (!asMetadata.issuer || !asMetadata.authorization_endpoint || !asMetadata.token_endpoint) {
		return error(400, "Invalid authorization server metadata");
	}
	if (!clientInfo.client_id) {
		return error(400, "Missing client_id in clientInfo");
	}

	const origin = config.PUBLIC_ORIGIN || url.origin;
	const redirectUri = `${origin}${base}/api/mcp/oauth/callback`;
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

	const cookieValue = signFlowCookie({
		flowId,
		verifier: codeVerifier,
		expectedState,
		asMetadata,
		clientInfo,
		resource: parsed.resource,
		redirectUri,
		popupMode: parsed.popupMode,
		redirectNext: parsed.redirectNext,
		expiresAt: Date.now() + FLOW_TTL_MS,
	});

	cookies.set(`${FLOW_COOKIE_NAME}-${flowId}`, cookieValue, {
		path: `${base}/api/mcp/oauth`,
		httpOnly: true,
		sameSite,
		secure,
		maxAge: Math.floor(FLOW_TTL_MS / 1000),
	});

	return json({ authUrl: authorizationUrl.toString(), flowId });
};
