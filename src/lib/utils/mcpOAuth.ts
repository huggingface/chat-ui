/**
 * Client-side OAuth helpers for MCP servers.
 *
 * The dance is server-orchestrated (because most authorization-server endpoints
 * lack CORS), but tokens land in the browser via either:
 *  - a popup window that postMessages back to the opener, or
 *  - a full-page redirect that drops a base64 handoff blob in `location.hash`
 *    on return.
 *
 * The browser then persists tokens alongside the custom MCP server entry in
 * localStorage (see `mcpServers.ts`).
 */

import { base } from "$app/paths";
import type {
	MCPAuthorizationServerMetadata,
	MCPClientInformation,
	MCPOAuthTokens,
} from "$lib/types/Tool";

export interface DiscoveryResponse {
	requiresAuth: boolean;
	resource?: string;
	resourceMetadataUrl?: string;
	asMetadata?: MCPAuthorizationServerMetadata;
	clientInfo?: MCPClientInformation;
	supportsDcr?: boolean;
	probeStatus?: number;
}

export interface OAuthCallbackPayload {
	ok: boolean;
	flowId: string;
	tokens?: MCPOAuthTokens;
	resource?: string;
	error?: string;
}

const POPUP_FEATURES = "popup=yes,width=600,height=750,noopener=no,noreferrer=no";

export async function discoverServer(url: string): Promise<DiscoveryResponse> {
	const res = await fetch(`${base}/api/mcp/oauth/discover`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(text || `Discovery failed (${res.status})`);
	}
	return (await res.json()) as DiscoveryResponse;
}

export async function startAuthFlow(args: {
	resource: string;
	asMetadata: MCPAuthorizationServerMetadata;
	clientInfo: MCPClientInformation;
	popupMode: boolean;
	redirectNext?: string;
	scope?: string;
}): Promise<{ authUrl: string; flowId: string }> {
	const res = await fetch(`${base}/api/mcp/oauth/start`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(args),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(text || `Failed to start authorization (${res.status})`);
	}
	return (await res.json()) as { authUrl: string; flowId: string };
}

/**
 * Thrown when the authorization server itself rejected the refresh_token
 * (RFC 6749 `invalid_grant` / revoked / rotated). The caller should wipe the
 * stored tokens and prompt the user to re-authorize. Distinct from generic
 * `Error`s, which represent transport-layer failures (offline, 5xx, timeout)
 * where the refresh_token is presumed still valid and tokens should be kept.
 */
export class OAuthRefreshRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OAuthRefreshRejectedError";
	}
}

export async function refreshAccessToken(args: {
	asMetadata: MCPAuthorizationServerMetadata;
	clientInfo: MCPClientInformation;
	resource: string;
	refreshToken: string;
}): Promise<MCPOAuthTokens> {
	const res = await fetch(`${base}/api/mcp/oauth/refresh`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			asMetadata: args.asMetadata,
			clientInfo: args.clientInfo,
			resource: args.resource,
			refresh_token: args.refreshToken,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		const message = text || `Refresh failed (${res.status})`;
		// 401 from /api/mcp/oauth/refresh means the AS rejected the refresh_token.
		// Anything else (502 transport / 5xx) is treated as transient by callers.
		if (res.status === 401) throw new OAuthRefreshRejectedError(message);
		throw new Error(message);
	}
	const body = (await res.json()) as { tokens: MCPOAuthTokens };
	return body.tokens;
}

export async function revokeAccessToken(args: {
	asMetadata: MCPAuthorizationServerMetadata;
	clientInfo: MCPClientInformation;
	token: string;
	tokenTypeHint?: "access_token" | "refresh_token";
}): Promise<boolean> {
	try {
		const res = await fetch(`${base}/api/mcp/oauth/revoke`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				asMetadata: args.asMetadata,
				clientInfo: args.clientInfo,
				token: args.token,
				token_type_hint: args.tokenTypeHint,
			}),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { revoked: boolean };
		return Boolean(body.revoked);
	} catch {
		return false;
	}
}

/**
 * Opens an OAuth popup and resolves with the postMessage payload from our
 * callback page. Rejects if the user closes the popup before a result arrives,
 * or if the popup never opens (popup-blocked / mobile). Caller can then fall
 * back to `runFullPageAuthFlow`.
 */
export function openAuthPopup(authUrl: string, flowId: string): Promise<OAuthCallbackPayload> {
	return new Promise((resolve, reject) => {
		let popup: Window | null;
		try {
			popup = window.open(authUrl, "mcp-oauth", POPUP_FEATURES);
		} catch {
			reject(new Error("popup-blocked"));
			return;
		}
		if (!popup) {
			reject(new Error("popup-blocked"));
			return;
		}

		let settled = false;
		const targetOrigin = window.location.origin;

		const cleanup = () => {
			window.removeEventListener("message", onMessage);
			clearInterval(pollHandle);
		};

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== targetOrigin) return;
			const data = event.data as { type?: string; payload?: OAuthCallbackPayload } | null;
			if (!data || data.type !== "mcp-oauth-result" || !data.payload) return;
			if (data.payload.flowId && data.payload.flowId !== flowId) return;
			if (settled) return;
			settled = true;
			cleanup();
			try {
				popup?.close();
			} catch {}
			resolve(data.payload);
		};

		const pollHandle = window.setInterval(() => {
			if (popup && popup.closed && !settled) {
				settled = true;
				cleanup();
				reject(new Error("popup-closed"));
			}
		}, 500);

		window.addEventListener("message", onMessage);

		// Hard timeout in case nothing ever happens (e.g. AS hangs)
		window.setTimeout(
			() => {
				if (settled) return;
				settled = true;
				cleanup();
				try {
					popup?.close();
				} catch {}
				reject(new Error("timeout"));
			},
			10 * 60 * 1000
		);
	});
}

/**
 * Mobile / popup-blocked fallback. Stashes the in-flight flow context in
 * sessionStorage keyed by flowId, then navigates the main tab to `authUrl`.
 * On return, `consumeRedirectHandoff()` picks up the result from the URL hash.
 */
export function runFullPageAuthFlow(args: { authUrl: string; flowId: string; serverId: string }) {
	const pending = {
		flowId: args.flowId,
		serverId: args.serverId,
		startedAt: Date.now(),
	};
	try {
		sessionStorage.setItem(SESSION_KEY_PENDING, JSON.stringify(pending));
	} catch {}
	window.location.href = args.authUrl;
}

const SESSION_KEY_PENDING = "mcp-oauth:pending";

export interface PendingFullPage {
	flowId: string;
	serverId: string;
	startedAt: number;
}

export function readPendingFullPage(): PendingFullPage | null {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY_PENDING);
		if (!raw) return null;
		return JSON.parse(raw) as PendingFullPage;
	} catch {
		return null;
	}
}

export function clearPendingFullPage() {
	try {
		sessionStorage.removeItem(SESSION_KEY_PENDING);
	} catch {}
}

/**
 * On page load, look for a `__mcp_oauth_handoff=` fragment in the URL hash.
 * If present, decode it, scrub it from the URL, and return the payload along
 * with any pending serverId we stashed before redirecting.
 */
export function consumeRedirectHandoff(): {
	payload: OAuthCallbackPayload;
	serverId: string;
} | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash;
	const m = hash.match(/[#&]__mcp_oauth_handoff=([^&]+)/);
	if (!m) return null;

	let payload: OAuthCallbackPayload;
	try {
		const json = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
		payload = JSON.parse(json) as OAuthCallbackPayload;
	} catch {
		return null;
	}

	const newHash = hash
		.replace(/(^|[#&])__mcp_oauth_handoff=[^&]+/, "$1")
		.replace(/^#&/, "#")
		.replace(/^#$/, "");
	try {
		const newUrl = window.location.pathname + window.location.search + (newHash || "");
		window.history.replaceState({}, "", newUrl);
	} catch {}

	const pending = readPendingFullPage();
	clearPendingFullPage();
	if (!pending) return null;
	if (payload.flowId && pending.flowId !== payload.flowId) return null;
	return { payload, serverId: pending.serverId };
}

export function isTokenExpiringSoon(tokens: MCPOAuthTokens, marginMs = 5 * 60 * 1000): boolean {
	if (!tokens.expires_at) return false;
	return Date.now() + marginMs >= tokens.expires_at;
}

export function isTokenExpired(tokens: MCPOAuthTokens): boolean {
	if (!tokens.expires_at) return false;
	return Date.now() >= tokens.expires_at;
}
