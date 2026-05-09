import { z } from "zod";
import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { logger } from "$lib/server/logger";
import { refreshTokens, tokensWithExpiresAt } from "$lib/server/mcp/oauth/exchange";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const Body = z.object({
	asMetadata: z.record(z.string(), z.unknown()),
	clientInfo: z.record(z.string(), z.unknown()),
	resource: z.string().url(),
	refresh_token: z.string().min(1),
});

export const POST: RequestHandler = async ({ request }) => {
	let parsed: z.infer<typeof Body>;
	try {
		parsed = Body.parse(await request.json());
	} catch (e) {
		return error(400, e instanceof Error ? e.message : "Invalid request body");
	}

	const asMetadata = parsed.asMetadata as unknown as AuthorizationServerMetadata;
	const clientInfo = parsed.clientInfo as unknown as OAuthClientInformationFull;

	if (!asMetadata.token_endpoint || !asMetadata.issuer) {
		return error(400, "Invalid authorization server metadata");
	}
	if (!clientInfo.client_id) {
		return error(400, "Missing client_id in clientInfo");
	}

	try {
		const tokens = await refreshTokens({
			asMetadata,
			clientInfo,
			resource: parsed.resource,
			refreshToken: parsed.refresh_token,
		});
		return json({ tokens: tokensWithExpiresAt(tokens) });
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Refresh failed";
		logger.warn({ err: msg }, "[mcp-oauth] refresh failed");
		// 401 means the AS rejected the refresh_token (invalid_grant / revoked /
		// rotated). 502 covers transport-layer or AS-side transient failures
		// (network down, AS 5xx, timeout) — clients should preserve tokens and
		// retry next window rather than wipe credentials on a network blip.
		const lower = msg.toLowerCase();
		const isInvalidGrant =
			lower.includes("invalid_grant") ||
			lower.includes("invalid_request") ||
			lower.includes("unauthorized") ||
			lower.includes("invalid_client");
		return error(isInvalidGrant ? 401 : 502, msg);
	}
};
