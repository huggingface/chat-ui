import { describe, expect, it } from "vitest";
import {
	assertIssuerMatches,
	assertProtectedResourceMatches,
	assertSafeOAuthUrl,
	parseAuthorizationServerMetadata,
	parseClientInformation,
} from "./validation";

const metadata = {
	issuer: "https://auth.example.com",
	authorization_endpoint: "https://auth.example.com/authorize",
	token_endpoint: "https://auth.example.com/token",
	response_types_supported: ["code"],
};

describe("OAuth metadata validation", () => {
	it("accepts public HTTPS authorization metadata", () => {
		expect(parseAuthorizationServerMetadata(metadata).issuer).toBe(metadata.issuer);
	});

	it.each([
		["issuer", "http://auth.example.com"],
		["authorization_endpoint", "http://auth.example.com/authorize"],
		["token_endpoint", "ftp://auth.example.com/token"],
		["registration_endpoint", "http://auth.example.com/register"],
		["revocation_endpoint", "http://auth.example.com/revoke"],
	])("rejects an unsafe %s", (field, value) => {
		expect(() => parseAuthorizationServerMetadata({ ...metadata, [field]: value })).toThrow(
			/public HTTPS URL/
		);
	});

	it("rejects credentials, fragments, and issuer query parameters", () => {
		expect(() =>
			assertSafeOAuthUrl("https://user:pass@example.com/token", "Token endpoint")
		).toThrow(/credentials/);
		expect(() =>
			assertSafeOAuthUrl("https://example.com/token#fragment", "Token endpoint")
		).toThrow(/fragment/);
		expect(() =>
			parseAuthorizationServerMetadata({ ...metadata, issuer: "https://auth.example.com?tenant=1" })
		).toThrow(/query/);
	});

	it("requires a complete nonempty client registration", () => {
		expect(
			parseClientInformation({
				client_id: "client",
				redirect_uris: ["https://chat.example.com/api/mcp/oauth/callback"],
			}).client_id
		).toBe("client");
		expect(() => parseClientInformation({ client_id: "", redirect_uris: [] })).toThrow(
			/must not be empty/
		);
	});
});

describe("OAuth metadata binding", () => {
	it("accepts equivalent issuer URL serialization", () => {
		expect(() => assertIssuerMatches("https://auth.example.com/", metadata)).not.toThrow();
	});

	it("rejects a metadata issuer substitution", () => {
		expect(() =>
			assertIssuerMatches("https://auth.example.com", {
				...metadata,
				issuer: "https://attacker.example.com",
			})
		).toThrow(/issuer mismatch/);
	});

	it("requires exact protected-resource binding", () => {
		expect(() =>
			assertProtectedResourceMatches("https://mcp.example.com/mcp/", {
				resource: "https://mcp.example.com/mcp/",
			})
		).not.toThrow();
		expect(() =>
			assertProtectedResourceMatches("https://mcp.example.com/mcp/", {
				resource: "https://mcp.example.com/mcp",
			})
		).toThrow(/metadata mismatch/);
	});
});
