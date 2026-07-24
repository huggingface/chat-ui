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
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ssrfSafeFetch } from "$lib/server/urlSafety";
import {
	assertPkceS256Supported,
	assertSafeOAuthUrl,
	parseAuthorizationServerMetadata,
	parseClientInformation,
} from "./validation";

export async function buildAuthorizationUrl(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	redirectUri: string;
	resource: string;
	state: string;
	scope?: string;
}): Promise<{ authorizationUrl: URL; codeVerifier: string }> {
	const metadata = parseAuthorizationServerMetadata(args.asMetadata);
	assertPkceS256Supported(metadata);
	const clientInformation = parseClientInformation(args.clientInfo);
	assertSafeOAuthUrl(args.resource, "MCP resource");
	return startAuthorization(metadata.issuer, {
		metadata,
		clientInformation,
		redirectUrl: args.redirectUri,
		state: args.state,
		scope: args.scope,
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
	const metadata = parseAuthorizationServerMetadata(args.asMetadata);
	const clientInformation = parseClientInformation(args.clientInfo);
	assertSafeOAuthUrl(args.resource, "MCP resource");
	const tokens = await exchangeAuthorization(metadata.issuer, {
		metadata,
		clientInformation,
		authorizationCode: args.code,
		codeVerifier: args.codeVerifier,
		redirectUri: args.redirectUri,
		resource: new URL(args.resource),
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
	});
	assertBearerTokens(tokens);
	return tokens;
}

export async function refreshTokens(args: {
	asMetadata: AuthorizationServerMetadata;
	clientInfo: OAuthClientInformationFull;
	resource: string;
	refreshToken: string;
}): Promise<OAuthTokens> {
	const metadata = parseAuthorizationServerMetadata(args.asMetadata);
	const clientInformation = parseClientInformation(args.clientInfo);
	assertSafeOAuthUrl(args.resource, "MCP resource");
	const tokens = await refreshAuthorization(metadata.issuer, {
		metadata,
		clientInformation,
		refreshToken: args.refreshToken,
		resource: new URL(args.resource),
		fetchFn: ssrfSafeFetch as unknown as typeof fetch,
	});
	assertBearerTokens(tokens);
	return tokens;
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
	let metadata: AuthorizationServerMetadata;
	let clientInformation: OAuthClientInformationFull;
	try {
		metadata = parseAuthorizationServerMetadata(args.asMetadata);
		clientInformation = parseClientInformation(args.clientInfo);
	} catch {
		return false;
	}
	const endpoint = (metadata as unknown as Record<string, unknown>).revocation_endpoint;
	if (!endpoint || typeof endpoint !== "string") return false;

	const body = new URLSearchParams();
	body.set("token", args.token);
	if (args.tokenTypeHint) body.set("token_type_hint", args.tokenTypeHint);
	body.set("client_id", clientInformation.client_id);
	if (clientInformation.client_secret) {
		body.set("client_secret", clientInformation.client_secret);
	}

	try {
		assertSafeOAuthUrl(endpoint, "Revocation endpoint");
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

export function assertBearerTokens(tokens: OAuthTokens): void {
	if (tokens.token_type.toLowerCase() !== "bearer") {
		throw new Error(`Unsupported OAuth token type: ${tokens.token_type}`);
	}
}

export function isRefreshGrantRejected(error: unknown): boolean {
	return error instanceof OAuthError && error.errorCode === "invalid_grant";
}

export function tokensWithExpiresAt(tokens: OAuthTokens): OAuthTokens & { expires_at?: number } {
	assertBearerTokens(tokens);
	if (typeof tokens.expires_in === "number" && tokens.expires_in > 0) {
		return { ...tokens, expires_at: Date.now() + tokens.expires_in * 1000 };
	}
	return { ...tokens };
}
