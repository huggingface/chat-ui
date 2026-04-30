import { describe, expect, it } from "vitest";
import {
	FLOW_TTL_MS,
	newFlowId,
	signFlowCookie,
	verifyFlowCookie,
	type OAuthFlowState,
} from "./state";

function makeState(overrides: Partial<OAuthFlowState> = {}): OAuthFlowState {
	return {
		flowId: newFlowId(),
		verifier: "abcdef-pkce-verifier",
		expectedState: "state-xyz",
		asMetadata: {
			issuer: "https://example.com",
			authorization_endpoint: "https://example.com/authorize",
			token_endpoint: "https://example.com/token",
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
		const cookie = signFlowCookie(state);
		const out = verifyFlowCookie(cookie);
		if (!out) throw new Error("expected verifyFlowCookie to return a payload");
		expect(out.flowId).toBe(state.flowId);
		expect(out.verifier).toBe(state.verifier);
		expect(out.expectedState).toBe(state.expectedState);
		expect(out.resource).toBe(state.resource);
	});

	it("rejects a tampered payload", () => {
		const cookie = signFlowCookie(makeState());
		const sig = cookie.slice(cookie.lastIndexOf(".") + 1);
		// Re-encode a different payload but keep the original signature.
		const tampered = Buffer.from('{"flowId":"x"}', "utf8").toString("base64url");
		expect(verifyFlowCookie(`${tampered}.${sig}`)).toBeNull();
	});

	it("rejects a tampered signature", () => {
		const cookie = signFlowCookie(makeState());
		const payload = cookie.slice(0, cookie.lastIndexOf("."));
		expect(verifyFlowCookie(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
	});

	it("rejects expired state", () => {
		const expired = signFlowCookie(makeState({ expiresAt: Date.now() - 1 }));
		expect(verifyFlowCookie(expired)).toBeNull();
	});

	it("rejects empty / malformed input", () => {
		expect(verifyFlowCookie(undefined)).toBeNull();
		expect(verifyFlowCookie("")).toBeNull();
		expect(verifyFlowCookie("not-a-cookie")).toBeNull();
		expect(verifyFlowCookie("missing.signature.parts")).toBeNull();
	});
});
