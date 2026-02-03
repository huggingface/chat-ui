/**
 * MCP OAuth Service
 * Handles OAuth discovery, flow initiation, and token exchange
 */

import { base } from "$app/paths";
import { generatePKCE } from "$lib/utils/pkce";
import {
	saveFlowState,
	clearFlowState,
	setToken,
	setOAuthConfig,
	getOAuthConfig,
	getToken,
	isTokenExpired,
} from "$lib/stores/mcpOAuthTokens";
import type {
	OAuthServerMetadata,
	McpOAuthToken,
	McpOAuthFlowState,
	OAuthDiscoveryResult,
	TokenResponse,
	ClientRegistrationResponse,
} from "$lib/types/McpOAuth";

const CALLBACK_PATH = "/api/mcp/oauth/callback";
const FLOW_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Discover OAuth server metadata from MCP server URL
 * Uses server-side proxy to avoid CORS issues with RFC 9728 discovery
 */
export async function discoverOAuthMetadata(
	serverUrl: string
): Promise<OAuthServerMetadata | null> {
	try {
		const response = await fetch(`${base}/api/mcp/oauth/discover`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: serverUrl }),
			signal: AbortSignal.timeout(20000),
		});

		if (!response.ok) return null;

		const data = await response.json();
		return data.metadata ?? null;
	} catch (error) {
		console.debug("OAuth discovery failed:", error);
		return null;
	}
}

export async function checkOAuthRequired(serverUrl: string): Promise<OAuthDiscoveryResult> {
	try {
		const metadata = await discoverOAuthMetadata(serverUrl);
		if (metadata) {
			return { required: true, metadata };
		}
		return { required: false };
	} catch (error) {
		return {
			required: false,
			error: error instanceof Error ? error.message : "Discovery failed",
		};
	}
}

/**
 * Register as an OAuth client using Dynamic Client Registration (RFC 7591)
 * Falls back to CIMD (Client ID Metadata Document) style if registration fails
 */
export async function registerOAuthClient(
	metadata: OAuthServerMetadata,
	_serverUrl: string
): Promise<string> {
	const callbackUrl = `${window.location.origin}${base}${CALLBACK_PATH}`;

	// If Dynamic Client Registration endpoint is available, try it
	if (metadata.registration_endpoint) {
		try {
			const response = await fetch(metadata.registration_endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					client_name: "Chat UI MCP Client",
					redirect_uris: [callbackUrl],
					token_endpoint_auth_method: "none", // Public client (no secret)
					grant_types: ["authorization_code", "refresh_token"],
					response_types: ["code"],
				}),
				signal: AbortSignal.timeout(10000),
			});

			if (response.ok) {
				const data = (await response.json()) as ClientRegistrationResponse;
				return data.client_id;
			}
		} catch (error) {
			console.warn("Dynamic client registration failed, falling back to CIMD:", error);
		}
	}

	// Fall back to CIMD: use our well-known URL as client_id
	// This follows the November 2025 MCP spec update for Client ID Metadata Documents
	return `${window.location.origin}${base}/.well-known/oauth-cimd`;
}

export function getCallbackUrl(): string {
	return `${window.location.origin}${base}${CALLBACK_PATH}`;
}

function openOAuthPopup(url: string, width: number, height: number): Window | null {
	const left = Math.round(window.screenX + (window.innerWidth - width) / 2);
	const top = Math.round(window.screenY + (window.innerHeight - height) / 2);

	return window.open(
		url,
		"mcp-oauth",
		`popup=yes,width=${width},height=${height},top=${top},left=${left},toolbar=no,menubar=no,scrollbars=yes`
	);
}

// Opens popup for OAuth, falls back to redirect if blocked
export async function startOAuthFlow(
	serverId: string,
	serverUrl: string,
	serverName: string,
	metadata: OAuthServerMetadata,
	returnTo?: string
): Promise<Window | null> {
	// Generate PKCE values
	const pkce = await generatePKCE();

	// Register/get client ID
	const clientId = await registerOAuthClient(metadata, serverUrl);

	// Build callback URL
	const callbackUrl = getCallbackUrl();

	// Save flow state to survive redirect/popup
	const flowState: McpOAuthFlowState = {
		serverId,
		serverUrl,
		serverName,
		pkce,
		metadata,
		clientId,
		startedAt: Date.now(),
		returnTo,
	};
	saveFlowState(flowState);

	// Build authorization URL
	const authUrl = new URL(metadata.authorization_endpoint);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", callbackUrl);
	authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");
	authUrl.searchParams.set("state", pkce.state);

	// Add scopes if server specifies supported scopes
	if (metadata.scopes_supported?.length) {
		// Request all supported scopes
		authUrl.searchParams.set("scope", metadata.scopes_supported.join(" "));
	}

	// Try to open popup (better UX - keeps app state)
	const popup = openOAuthPopup(authUrl.toString(), 600, 700);

	if (popup) {
		// Popup opened successfully
		return popup;
	}

	// Popup blocked - fall back to redirect
	console.warn("OAuth popup blocked, falling back to redirect");
	window.location.href = authUrl.toString();
	return null;
}

export async function exchangeCodeForTokens(
	code: string,
	flowState: McpOAuthFlowState
): Promise<McpOAuthToken> {
	const callbackUrl = getCallbackUrl();

	const response = await fetch(flowState.metadata.token_endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: callbackUrl,
			client_id: flowState.clientId,
			code_verifier: flowState.pkce.codeVerifier,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		clearFlowState();
		throw new Error(`Token exchange failed: ${errorText}`);
	}

	const data = (await response.json()) as TokenResponse;

	// Calculate expiry timestamp
	// Use || to catch 0 or falsy values, ensure minimum 1 hour expiry
	const expiresIn = data.expires_in && data.expires_in > 0 ? data.expires_in : 3600;

	const token: McpOAuthToken = {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt: Date.now() + expiresIn * 1000,
		tokenType: data.token_type ?? "Bearer",
		scope: data.scope,
	};

	// Store the token and OAuth config
	setToken(flowState.serverId, token);
	setOAuthConfig(flowState.serverId, {
		serverId: flowState.serverId,
		serverUrl: flowState.serverUrl,
		clientId: flowState.clientId,
		metadata: flowState.metadata,
	});

	// Clear flow state
	clearFlowState();

	return token;
}

export async function refreshOAuthToken(serverId: string): Promise<McpOAuthToken | null> {
	const config = getOAuthConfig(serverId);
	const token = getToken(serverId);

	if (!config || !token?.refreshToken) {
		return null;
	}

	try {
		const response = await fetch(config.metadata.token_endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: token.refreshToken,
				client_id: config.clientId,
			}),
		});

		if (!response.ok) {
			console.warn("Token refresh failed:", response.status);
			return null;
		}

		const data = (await response.json()) as TokenResponse;
		const expiresIn = data.expires_in && data.expires_in > 0 ? data.expires_in : 3600;

		const newToken: McpOAuthToken = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token ?? token.refreshToken, // Keep old if not returned
			expiresAt: Date.now() + expiresIn * 1000,
			tokenType: data.token_type ?? "Bearer",
			scope: data.scope ?? token.scope,
		};

		setToken(serverId, newToken);
		return newToken;
	} catch (error) {
		console.error("Token refresh error:", error);
		return null;
	}
}

export function validateFlowState(
	flowState: McpOAuthFlowState | null,
	state: string
): { valid: boolean; error?: string } {
	if (!flowState) {
		return { valid: false, error: "OAuth flow state not found. Please try again." };
	}

	// Validate state to prevent CSRF
	if (state !== flowState.pkce.state) {
		return { valid: false, error: "Invalid state parameter. Possible CSRF attack." };
	}

	// Check flow hasn't expired
	if (Date.now() - flowState.startedAt > FLOW_TIMEOUT_MS) {
		return { valid: false, error: "OAuth flow expired. Please try again." };
	}

	return { valid: true };
}

// Returns token, refreshing if expired
export async function getValidToken(serverId: string): Promise<McpOAuthToken | null> {
	const token = getToken(serverId);

	if (!token) {
		return null;
	}

	// If token is expired, try to refresh
	if (isTokenExpired(token)) {
		const refreshed = await refreshOAuthToken(serverId);
		return refreshed;
	}

	return token;
}
