import { describe, expect, it } from "vitest";
import { GET } from "./+server";

describe("MCP OAuth client ID metadata document", () => {
	it("publishes stable, self-identifying public-client metadata", async () => {
		const response = await GET({
			url: new URL("https://chat.example.com/api/mcp/oauth/client-metadata"),
		} as unknown as Parameters<typeof GET>[0]);
		const metadata = (await response.json()) as Record<string, unknown>;

		expect(response.status).toBe(200);
		expect(metadata).toEqual(
			expect.objectContaining({
				client_id: "https://chat.example.com/api/mcp/oauth/client-metadata",
				redirect_uris: ["https://chat.example.com/api/mcp/oauth/callback"],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			})
		);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("does not publish a URL-based client ID over plain HTTP", async () => {
		const response = await GET({
			url: new URL("http://localhost:5173/api/mcp/oauth/client-metadata"),
		} as unknown as Parameters<typeof GET>[0]);
		expect(response.status).toBe(404);
	});
});
