import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { config } from "$lib/server/config";

/**
 * Per-flow state we keep for the duration of an OAuth dance. It lives in an
 * HttpOnly cookie keyed by `flowId`, so it survives the popup -> AS -> callback
 * round-trip without being exposed to JS in the chat-ui origin (mitigates the
 * impact of XSS during the window the verifier is alive). The cookie is
 * deleted by the callback handler as soon as it has been consumed, regardless
 * of whether the exchange succeeded.
 */
export interface OAuthFlowState {
	flowId: string;
	verifier: string;
	expectedState: string;
	asMetadata: import("$lib/types/Tool").MCPAuthorizationServerMetadata;
	clientInfo: import("$lib/types/Tool").MCPClientInformation;
	resource: string;
	redirectUri: string;
	popupMode: boolean;
	redirectNext?: string;
	expiresAt: number;
}

const HMAC_SECRET_FALLBACK = "mcp-oauth-flow";

function hmacSecret(): string {
	const secret =
		(config as unknown as { OPENID_CLIENT_SECRET?: string }).OPENID_CLIENT_SECRET ||
		(config as unknown as { COOKIE_SECRET?: string }).COOKIE_SECRET ||
		"";
	return secret.length > 0 ? secret : HMAC_SECRET_FALLBACK;
}

function sign(payload: string): string {
	return createHmac("sha256", hmacSecret()).update(payload).digest("base64url");
}

export function newFlowId(): string {
	return randomUUID();
}

export function signFlowCookie(state: OAuthFlowState): string {
	const json = JSON.stringify(state);
	const payload = Buffer.from(json, "utf8").toString("base64url");
	const sig = sign(payload);
	return `${payload}.${sig}`;
}

export function verifyFlowCookie(value: string | undefined): OAuthFlowState | null {
	if (!value || typeof value !== "string") return null;
	const dot = value.lastIndexOf(".");
	if (dot < 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);

	const expected = sign(payload);
	const a = Buffer.from(expected);
	const b = Buffer.from(sig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	let parsed: OAuthFlowState;
	try {
		parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return null;
	}

	if (typeof parsed.expiresAt !== "number" || Date.now() > parsed.expiresAt) {
		return null;
	}
	if (
		typeof parsed.flowId !== "string" ||
		typeof parsed.verifier !== "string" ||
		typeof parsed.expectedState !== "string"
	) {
		return null;
	}
	return parsed;
}

export const FLOW_COOKIE_NAME = "hfChat-mcp-oauth-flow";
export const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes
