import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RegistryServer } from "./+server";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRegistryResponse(servers: RegistryServer[]) {
	return {
		ok: true,
		json: async () => ({
			servers: servers.map((s) => ({ server: s, _meta: {} })),
			metadata: { count: servers.length },
		}),
	};
}

describe("GET /api/mcp/registry", () => {
	beforeEach(() => {
		vi.resetModules();
		mockFetch.mockReset();
	});

	it("returns normalized entries with remote URL", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/test-server",
					title: "Test Server",
					description: "A test MCP server",
					remotes: [{ type: "streamable-http", url: "https://test.example.com/mcp" }],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=test");
		const response = await GET({ url });
		const data = await response.json();

		expect(data).toHaveLength(1);
		expect(data[0].name).toBe("io.github/test-server");
		expect(data[0].title).toBe("Test Server");
		expect(data[0].url).toBe("https://test.example.com/mcp");
	});

	it("excludes servers with no remote URL", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/npm-only",
					description: "NPM only server",
					remotes: [],
				},
				{
					name: "io.github/with-remote",
					description: "Has a remote",
					remotes: [{ type: "sse", url: "https://remote.example.com/mcp" }],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=exclude-pkg-test");
		const response = await GET({ url });
		const data = await response.json();

		expect(data).toHaveLength(1);
		expect(data[0].name).toBe("io.github/with-remote");
	});

	it("returns 502 when registry is unavailable and no cache", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network failure"));

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=unique-query-no-cache-xyz");
		const response = await GET({ url });

		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it("prefers SSE transport when no streamable-http remote", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/sse-server",
					description: "SSE server",
					remotes: [{ type: "sse", url: "https://sse.example.com/mcp" }],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=sse-server-unique-xyz");
		const response = await GET({ url });
		const data = await response.json();

		expect(data[0].url).toBe("https://sse.example.com/mcp");
	});

	it("prefers streamable-http over sse when both present", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/multi-transport",
					description: "Multiple transports",
					remotes: [
						{ type: "sse", url: "https://sse.example.com/mcp" },
						{ type: "streamable-http", url: "https://http.example.com/mcp" },
					],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=multi-transport-unique-xyz");
		const response = await GET({ url });
		const data = await response.json();

		expect(data[0].url).toBe("https://http.example.com/mcp");
	});

	it("includes required headers from selected remote", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/auth-server",
					description: "Server requiring auth",
					remotes: [
						{
							type: "streamable-http",
							url: "https://auth.example.com/mcp",
							headers: [
								{
									name: "Authorization",
									description: "Bearer token",
									isRequired: true,
									isSecret: true,
								},
								{
									name: "X-Optional",
									description: "Optional header",
									isRequired: false,
								},
							],
						},
					],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=auth-server-unique-xyz");
		const response = await GET({ url });
		const data = await response.json();

		expect(data[0].requiredHeaders).toHaveLength(1);
		expect(data[0].requiredHeaders[0].name).toBe("Authorization");
		expect(data[0].requiredHeaders[0].description).toBe("Bearer token");
		expect(data[0].requiredHeaders[0].isSecret).toBe(true);
	});

	it("omits requiredHeaders when remote has none", async () => {
		mockFetch.mockResolvedValueOnce(
			makeRegistryResponse([
				{
					name: "io.github/no-auth-server",
					description: "No auth needed",
					remotes: [{ type: "streamable-http", url: "https://noauth.example.com/mcp" }],
				},
			])
		);

		const { GET } = await import("./+server");
		const url = new URL("http://localhost/api/mcp/registry?search=no-auth-unique-xyz");
		const response = await GET({ url });
		const data = await response.json();

		expect(data[0].requiredHeaders).toBeUndefined();
	});
});
