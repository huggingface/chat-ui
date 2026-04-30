import {
	exchangeAuthorization,
	refreshAuthorization,
	startAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	AuthorizationServerMetadata,
	OAuthClientInformationFull,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { ssrfSafeFetch } from "$lib/server/urlSafety";

export async function buildAuthorizationUrl(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	redirectUri: string;
	resource: string;
	state: string;
	scope?: string;
}): Promise<{ authorizationUrl: URL; codeVerifier: string }> {
	return startAuthorization(args.asMetadata.issuer, {
		metadata: args.asMetadata,
		clientInformation: args.clientInfo,
		redirectUrl: args.redirectUri,
		state: args.state,
		scope: args.scope ?? args.asMetadata.scopes_supported?.join(" "),
		resource: new URL(args.resource),
	});
}

export async function exchangeCodeForTokens(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	redirectUri: string;
	resource: string;
	code: string;
	codeVerifier: string;
}): Promise<OAuthTokens> {
	return exchangeAuthorization(args.asMetadata.issuer, {
		metadata: args.asMetadata,
		clientInformation: args.clientInfo,
		authorizationCode: args.code,
		codeVerifier: args.codeVerifier,
		redirectUri: args.redirectUri,
		resource: new URL(args.resource),
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
	});
}

export async function refreshTokens(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	resource: string;
	refreshToken: string;
}): Promise<OAuthTokens> {
	return refreshAuthorization(args.asMetadata.issuer, {
		metadata: args.asMetadata,
		clientInformation: args.clientInfo,
		refreshToken: args.refreshToken,
		resource: new URL(args.resource),
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
	});
}

/**
 * Best-effort RFC 7009 token revocation. Returns `true` if the AS confirmed
 * revocation, `false` if it doesn't expose `revocation_endpoint` or returns an
 * error. Never throws — disconnect should never block on the AS.
 */
export async function tryRevokeToken(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	token: string;
	tokenTypeHint?: "access_token" | "refresh_token";
}): Promise<boolean> {
	const endpoint = (args.asMetadata as unknown as Record<string, unknown>).revocation_endpoint;
	if (!endpoint || typeof endpoint !== "string") return false;

	const body = new URLSearchParams();
	body.set("token", args.token);
	if (args.tokenTypeHint) body.set("token_type_hint", args.tokenTypeHint);
	body.set("client_id", args.clientInfo.client_id);
	if (args.clientInfo.client_secret) {
		body.set("client_secret", args.clientInfo.client_secret);
	}

	try {
		const res = await ssrfSafeFetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body,
		});
		try {
			await res.body?.cancel();
		} catch {}
		return res.ok;
	} catch {
		return false;
	}
}

export function tokensWithExpiresAt(tokens: OAuthTokens): OAuthTokens & { expires_at?: number } {
	if (typeof tokens.expires_in === "number" && tokens.expires_in > 0) {
		return { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
	}
	return { ...tokens };
}
