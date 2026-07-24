/**
 * Client-side OAuth helpers for MCP servers.
 *
 * The dance is server-orchestrated (because most authorization-server endpoints
 * lack CORS), and the browser receives only a non-secret connection status via:
 *  - a popup window that postMessages back to the opener, or
 *  - a full-page redirect that drops a base64 handoff blob in `location.hash`
 *    on return.
 *
 * OAuth tokens, dynamic-registration credentials, discovery metadata, PKCE
 * verifiers, and CSRF state remain in the server-side connection store.
 */

import { base } from "$app/paths";
import type { MCPClientInformation, MCPOAuthState } from "$lib/types/Tool";

export interface DiscoveryResponse {
	requiresAuth: boolean;
	connection?: MCPOAuthState;
	probeStatus?: number;
}

export interface OAuthCallbackPayload {
	ok: boolean;
	flowId: string;
	connection?: MCPOAuthState;
	error?: string;
}

const POPUP_FEATURES = "popup=yes,width=600,height=750,noopener=no,noreferrer=no";
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

function isOAuthCallbackPayload(value: unknown): value is OAuthCallbackPayload {
	if (!value || typeof value !== "object") return false;
	const payload = value as Record<string, unknown>;
	if (typeof payload.ok !== "boolean" || typeof payload.flowId !== "string" || !payload.flowId) {
		return false;
	}
	if (payload.error !== undefined && typeof payload.error !== "string") return false;
	if (payload.connection !== undefined) {
		if (!payload.connection || typeof payload.connection !== "object") return false;
		const connection = payload.connection as Record<string, unknown>;
		if (
			typeof connection.connectionId !== "string" ||
			!connection.connectionId ||
			typeof connection.issuer !== "string" ||
			(connection.status !== "authorized" && connection.status !== "authorization_required")
		) {
			return false;
		}
	}
	return true;
}

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
	connectionId: string;
	clientInfo?: MCPClientInformation;
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

export async function refreshOAuthConnection(connectionId: string): Promise<MCPOAuthState> {
	const res = await fetch(`${base}/api/mcp/oauth/refresh`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ connectionId }),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(text || `Refresh failed (${res.status})`);
	}
	const body = (await res.json()) as { connection: MCPOAuthState };
	return body.connection;
}

export async function disconnectOAuthConnection(connectionId: string): Promise<boolean> {
	try {
		const res = await fetch(`${base}/api/mcp/oauth/revoke`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ connectionId }),
		});
		if (!res.ok) return false;
		const body = (await res.json()) as { disconnected: boolean };
		return Boolean(body.disconnected);
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
			window.clearInterval(pollHandle);
			window.clearTimeout(timeoutHandle);
		};

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== targetOrigin) return;
			if (event.source !== popup) return;
			const data = event.data as { type?: string; payload?: OAuthCallbackPayload } | null;
			if (
				!data ||
				data.type !== "mcp-oauth-result" ||
				!isOAuthCallbackPayload(data.payload) ||
				data.payload.flowId !== flowId
			) {
				return;
			}
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
		const timeoutHandle = window.setTimeout(() => {
			if (settled) return;
			settled = true;
			cleanup();
			try {
				popup?.close();
			} catch {}
			reject(new Error("timeout"));
		}, FLOW_TIMEOUT_MS);
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
		const parsed = JSON.parse(raw) as Partial<PendingFullPage>;
		if (
			typeof parsed.flowId !== "string" ||
			!parsed.flowId ||
			typeof parsed.serverId !== "string" ||
			!parsed.serverId ||
			typeof parsed.startedAt !== "number" ||
			parsed.startedAt > Date.now() ||
			Date.now() - parsed.startedAt > FLOW_TIMEOUT_MS
		) {
			clearPendingFullPage();
			return null;
		}
		return parsed as PendingFullPage;
	} catch {
		clearPendingFullPage();
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

	const newHash = hash
		.replace(/(^|[#&])__mcp_oauth_handoff=[^&]+/, "$1")
		.replace(/^#&/, "#")
		.replace(/^#$/, "");
	try {
		const newUrl = window.location.pathname + window.location.search + (newHash || "");
		window.history.replaceState({}, "", newUrl);
	} catch {}

	let payload: OAuthCallbackPayload;
	try {
		const encoded = m[1].replace(/-/g, "+").replace(/_/g, "/");
		const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
		const decoded = JSON.parse(atob(padded)) as unknown;
		if (!isOAuthCallbackPayload(decoded)) return null;
		payload = decoded;
	} catch {
		return null;
	}

	const pending = readPendingFullPage();
	clearPendingFullPage();
	if (!pending) return null;
	if (pending.flowId !== payload.flowId) return null;
	return { payload, serverId: pending.serverId };
}
