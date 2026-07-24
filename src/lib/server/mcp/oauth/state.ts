import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";
import {
	parseAuthorizationServerMetadata,
	parseClientInformation,
} from "$lib/server/mcp/oauth/validation";

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

const FlowStateSchema = z.object({
	flowId: z.string().uuid(),
	verifier: z
		.string()
		.min(43)
		.max(128)
		.regex(/^[A-Za-z0-9\-._~]+$/),
	expectedState: z.string().uuid(),
	asMetadata: z.unknown(),
	clientInfo: z.unknown(),
	resource: z.string().url(),
	redirectUri: z.string().url(),
	popupMode: z.boolean(),
	redirectNext: z.string().max(2048).optional(),
	expiresAt: z.number().finite(),
});

const MIN_SIGNING_KEY_BYTES = 32;
const MAX_FLOW_COOKIE_BYTES = 3800;

function assertSigningKey(signingKey: string): void {
	if (Buffer.byteLength(signingKey, "utf8") < MIN_SIGNING_KEY_BYTES) {
		throw new Error("OAuth flow signing key must contain at least 32 bytes");
	}
}

function sign(payload: string, signingKey: string): string {
	assertSigningKey(signingKey);
	return createHmac("sha256", signingKey).update(payload).digest("base64url");
}

function parseFlowState(input: unknown): OAuthFlowState {
	const parsed = FlowStateSchema.parse(input);
	return {
		...parsed,
		asMetadata: parseAuthorizationServerMetadata(parsed.asMetadata),
		clientInfo: parseClientInformation(parsed.clientInfo),
	};
}

export function newFlowId(): string {
	return randomUUID();
}

export function signFlowCookie(state: OAuthFlowState, signingKey: string): string {
	const json = JSON.stringify(parseFlowState(state));
	const payload = Buffer.from(json, "utf8").toString("base64url");
	const sig = sign(payload, signingKey);
	const value = `${payload}.${sig}`;
	if (Buffer.byteLength(value, "utf8") > MAX_FLOW_COOKIE_BYTES) {
		throw new Error("OAuth flow state is too large for a browser cookie");
	}
	return value;
}

export function verifyFlowCookie(
	value: string | undefined,
	signingKey: string
): OAuthFlowState | null {
	if (!value || typeof value !== "string") return null;
	if (Buffer.byteLength(value, "utf8") > MAX_FLOW_COOKIE_BYTES) return null;
	const dot = value.lastIndexOf(".");
	if (dot < 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);

	let expected: string;
	try {
		expected = sign(payload, signingKey);
	} catch {
		return null;
	}
	const a = Buffer.from(expected);
	const b = Buffer.from(sig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	let parsed: OAuthFlowState;
	try {
		parsed = parseFlowState(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
	} catch {
		return null;
	}

	if (typeof parsed.expiresAt !== "number" || Date.now() > parsed.expiresAt) {
		return null;
	}
	return parsed;
}

export const FLOW_COOKIE_NAME = "hfChat-mcp-oauth-flow";
export const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes
