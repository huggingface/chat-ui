import { describe, it, expect, vi } from "vitest";
import type { MCPOAuthConnection } from "$lib/types/MCPOAuthConnection";

// Supply an encryption key (real config reads it from env; here we inject a fixed one).
vi.mock("$lib/server/config", () => ({
	config: new Proxy(
		{ MCP_OAUTH_ENCRYPTION_KEY: "unit-test-encryption-secret-value" } as Record<string, string>,
		{ get: (target, prop) => (typeof prop === "string" && prop in target ? target[prop] : "") }
	),
}));
vi.mock("$lib/server/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
	encryptSecret,
	decryptSecret,
	encryptTokens,
	encryptClientInfo,
	encryptFlow,
	decryptConnection,
} from "./encryption";

describe("MCP OAuth credential encryption", () => {
	it("round-trips a secret and stores it as tagged ciphertext", () => {
		const plaintext = "super-secret-refresh-token";
		const enc = encryptSecret(plaintext);
		expect(enc).not.toBe(plaintext);
		expect(enc.startsWith("enc.v1:")).toBe(true);
		expect(decryptSecret(enc)).toBe(plaintext);
	});

	it("uses a fresh IV so the same plaintext encrypts differently", () => {
		expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
	});

	it("passes through legacy plaintext (no marker) unchanged", () => {
		expect(decryptSecret("legacy-plaintext-token")).toBe("legacy-plaintext-token");
	});

	it("fails closed to an empty value on a tampered ciphertext", () => {
		const enc = encryptSecret("secret");
		const tampered = enc.slice(0, -2) + (enc.endsWith("AA") ? "BB" : "AA");
		expect(decryptSecret(tampered)).toBe("");
	});

	it("encrypts only the secret fields of a stored connection and decrypts them back", () => {
		const tokens = encryptTokens({
			access_token: "acc",
			refresh_token: "ref",
			id_token: "idt",
			token_type: "Bearer",
			scope: "tools.read",
			expires_at: 123,
		});
		// Secrets are ciphertext...
		expect(tokens.access_token.startsWith("enc.v1:")).toBe(true);
		expect(tokens.refresh_token?.startsWith("enc.v1:")).toBe(true);
		// ...metadata stays plaintext (so projections/queries keep working).
		expect(tokens.scope).toBe("tools.read");
		expect(tokens.expires_at).toBe(123);

		const clientInfo = encryptClientInfo({
			client_id: "cid",
			client_secret: "csecret",
			redirect_uris: ["https://x/cb"],
		});
		expect(clientInfo.client_id).toBe("cid");
		expect(clientInfo.client_secret?.startsWith("enc.v1:")).toBe(true);

		const flow = encryptFlow({
			id: "f",
			expectedState: "state",
			verifier: "pkce-verifier",
			redirectUri: "https://x/cb",
			popupMode: true,
			expiresAt: new Date(),
		});
		expect(flow.expectedState).toBe("state"); // CSRF state stays queryable
		expect(flow.verifier.startsWith("enc.v1:")).toBe(true);

		const decrypted = decryptConnection({
			tokens,
			clientInfo,
			flow,
		} as unknown as MCPOAuthConnection);
		expect(decrypted.tokens?.access_token).toBe("acc");
		expect(decrypted.tokens?.refresh_token).toBe("ref");
		expect(decrypted.clientInfo?.client_secret).toBe("csecret");
		expect(decrypted.flow?.verifier).toBe("pkce-verifier");
	});
});
