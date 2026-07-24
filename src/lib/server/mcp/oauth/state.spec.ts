import { describe, expect, it } from "vitest";
import {
	FLOW_TTL_MS,
	newFlowId,
	signFlowCookie,
	verifyFlowCookie,
	type OAuthFlowState,
} from "./state";

const signingKey = "test-signing-key-that-is-at-least-32-bytes-long";

function makeState(overrides: Partial<OAuthFlowState> = {}): OAuthFlowState {
	return {
		flowId: newFlowId(),
		verifier: "abcdef-pkce-verifier-abcdefghijklmnopqrstuvwxyz",
		expectedState: "a73debb8-a0c5-4e90-b3bf-bc14af6ee18c",
		asMetadata: {
			issuer: "https://example.com",
			authorization_endpoint: "https://example.com/authorize",
			token_endpoint: "https://example.com/token",
			response_types_supported: ["code"],
		},
		clientInfo: {
			client_id: "client123",
			redirect_uris: ["https://chat.example/api/mcp/oauth/callback"],
		},
		resource: "https://mcp.example.com",
		redirectUri: "https://chat.example/api/mcp/oauth/callback",
		popupMode: true,
		expiresAt: Date.now() + FLOW_TTL_MS,
		...overrides,
	};
}

describe("OAuth flow cookie", () => {
	it("round-trips a valid state", () => {
		const state = makeState();
		const cookie = signFlowCookie(state, signingKey);
		const out = verifyFlowCookie(cookie, signingKey);
		if (!out) throw new Error("expected verifyFlowCookie to return a payload");
		expect(out.flowId).toBe(state.flowId);
		expect(out.verifier).toBe(state.verifier);
		expect(out.expectedState).toBe(state.expectedState);
		expect(out.resource).toBe(state.resource);
	});

	it("rejects a tampered payload", () => {
		const cookie = signFlowCookie(makeState(), signingKey);
		const sig = cookie.slice(cookie.lastIndexOf(".") + 1);
		// Re-encode a different payload but keep the original signature.
		const tampered = Buffer.from('{"flowId":"x"}', "utf8").toString("base64url");
		expect(verifyFlowCookie(`${tampered}.${sig}`, signingKey)).toBeNull();
	});

	it("rejects a tampered signature", () => {
		const cookie = signFlowCookie(makeState(), signingKey);
		const payload = cookie.slice(0, cookie.lastIndexOf("."));
		expect(
			verifyFlowCookie(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, signingKey)
		).toBeNull();
	});

	it("rejects expired state", () => {
		const expired = signFlowCookie(makeState({ expiresAt: Date.now() - 1 }), signingKey);
		expect(verifyFlowCookie(expired, signingKey)).toBeNull();
	});

	it("rejects empty / malformed input", () => {
		expect(verifyFlowCookie(undefined, signingKey)).toBeNull();
		expect(verifyFlowCookie("", signingKey)).toBeNull();
		expect(verifyFlowCookie("not-a-cookie", signingKey)).toBeNull();
		expect(verifyFlowCookie("missing.signature.parts", signingKey)).toBeNull();
	});

	it("binds the cookie to its signing context", () => {
		const cookie = signFlowCookie(makeState(), signingKey);
		expect(verifyFlowCookie(cookie, "another-signing-key-that-is-at-least-32-bytes")).toBeNull();
	});

	it("rejects incomplete state before signing", () => {
		expect(() =>
			signFlowCookie(
				makeState({
					clientInfo: { client_id: "", redirect_uris: [] },
				}),
				signingKey
			)
		).toThrow(/must not be empty/);
	});

	it("fails closed when the signing context is weak", () => {
		expect(() => signFlowCookie(makeState(), "public-default")).toThrow(/at least 32 bytes/);
	});

	it("fails explicitly instead of silently overflowing the cookie limit", () => {
		expect(() =>
			signFlowCookie(
				makeState({
					asMetadata: {
						...makeState().asMetadata,
						large_extension: "x".repeat(4000),
					},
				}),
				signingKey
			)
		).toThrow(/too large/);
	});
});
