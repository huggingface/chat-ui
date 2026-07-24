import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import { randomUUID } from "crypto";
import type { RequestHandler } from "./$types";
import { buildAuthorizationUrl } from "$lib/server/mcp/oauth/exchange";
import { oauthCallbackUri, safeLocalReturnPath } from "$lib/server/mcp/oauth/redirect";
import { parseClientInformation } from "$lib/server/mcp/oauth/validation";
import { getOAuthConnection, saveAuthorizationFlow } from "$lib/server/mcp/oauth/connections";
import type { MCPClientInformation } from "$lib/types/Tool";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const Body = z.object({
	connectionId: z.string().min(1),
	clientInfo: z.record(z.string(), z.unknown()).optional(),
	popupMode: z.boolean().default(true),
	redirectNext: z.string().optional(),
	scope: z.string().optional(),
});

const FLOW_TTL_MS = 10 * 60 * 1000;

export const POST: RequestHandler = async ({ request, url, locals }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	let connection;
	let clientInfo: MCPClientInformation;
	let clientWasManuallyEntered: boolean;
	let redirectUri: string;
	try {
		connection = await getOAuthConnection(locals, parsed.connectionId);
		redirectUri = oauthCallbackUri(url);
		if (connection.clientInfo) {
			clientInfo = parseClientInformation(connection.clientInfo);
			clientWasManuallyEntered = Boolean(connection.clientWasManuallyEntered);
		} else if (parsed.clientInfo) {
			clientInfo = parseClientInformation(parsed.clientInfo);
			clientWasManuallyEntered = true;
		} else {
			return error(400, "OAuth client information is required");
		}
		if (clientInfo.redirect_uris.length > 0 && !clientInfo.redirect_uris.includes(redirectUri)) {
			return error(400, "OAuth client is not registered for the canonical redirect URI");
		}
		clientInfo = { ...clientInfo, redirect_uris: [redirectUri] };
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid OAuth configuration");
	}

	const flowId = randomUUID();
	const expectedState = randomUUID();

	let authorizationUrl: URL;
	let codeVerifier: string;
	try {
		const built = await buildAuthorizationUrl({
			asMetadata: connection.asMetadata as AuthorizationServerMetadata,
			clientInfo: clientInfo as OAuthClientInformationFull,
			redirectUri,
			resource: connection.resource,
			state: expectedState,
			scope: parsed.scope,
		});
		authorizationUrl = built.authorizationUrl;
		codeVerifier = built.codeVerifier;
	} catch (e) {
		return error(502, e instanceof Error ? e.message : "Failed to build authorization URL");
	}

	try {
		await saveAuthorizationFlow(locals, connection, {
			clientInfo,
			clientWasManuallyEntered,
			flow: {
				id: flowId,
				expectedState,
				verifier: codeVerifier,
				redirectUri,
				popupMode: parsed.popupMode,
				redirectNext: parsed.redirectNext ? safeLocalReturnPath(parsed.redirectNext) : undefined,
				expiresAt: new Date(Date.now() + FLOW_TTL_MS),
			},
		});
	} catch (e) {
		return error(409, e instanceof Error ? e.message : "Could not save OAuth flow state");
	}

	return json({ authUrl: authorizationUrl.toString(), flowId });
};
