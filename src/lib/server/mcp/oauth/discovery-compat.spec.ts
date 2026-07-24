import { describe, expect, it } from "vitest";
import { buildDiscoveryUrls } from "@modelcontextprotocol/sdk/client/auth.js";
import { buildClientMetadataDocumentClient, MCP_OAUTH_PROTOCOL_VERSION } from "./discover";

describe("MCP 2025-11-25 discovery compatibility", () => {
	it("uses the 2025-11-25 protocol version for probes and metadata requests", () => {
		expect(MCP_OAUTH_PROTOCOL_VERSION).toBe("2025-11-25");
	});

	it("tries OAuth and OpenID discovery endpoints in specification order", () => {
		expect(
			buildDiscoveryUrls("https://auth.example.com/tenant1").map(({ url }) => url.href)
		).toEqual([
			"https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
			"https://auth.example.com/.well-known/openid-configuration/tenant1",
			"https://auth.example.com/tenant1/.well-known/openid-configuration",
		]);
		expect(buildDiscoveryUrls("https://auth.example.com").map(({ url }) => url.href)).toEqual([
			"https://auth.example.com/.well-known/oauth-authorization-server",
			"https://auth.example.com/.well-known/openid-configuration",
		]);
	});

	it("prefers an HTTPS Client ID Metadata Document when advertised", () => {
		const client = buildClientMetadataDocumentClient(
			{ client_id_metadata_document_supported: true },
			{
				clientMetadataUri: "https://chat.example.com/api/mcp/oauth/client-metadata",
				redirectUri: "https://chat.example.com/api/mcp/oauth/callback",
				appName: "Chat UI",
			}
		);
		expect(client?.client_id).toBe("https://chat.example.com/api/mcp/oauth/client-metadata");
		expect(
			buildClientMetadataDocumentClient(
				{ client_id_metadata_document_supported: true },
				{
					clientMetadataUri: "http://localhost/api/mcp/oauth/client-metadata",
					redirectUri: "http://localhost/api/mcp/oauth/callback",
					appName: "Chat UI",
				}
			)
		).toBeUndefined();
	});
});
