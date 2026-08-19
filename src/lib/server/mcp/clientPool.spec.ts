import { describe, it, expect, vi, beforeEach } from "vitest";

const built = vi.hoisted(() => ({ clients: [] as { closed: boolean }[] }));

vi.mock("./client", () => ({
	createMcpClient: () => {
		const client = {
			closed: false,
			async connect() {},
			async close() {
				this.closed = true;
			},
		};
		built.clients.push(client);
		return client;
	},
}));
vi.mock("@modelcontextprotocol/client", () => ({
	StreamableHTTPClientTransport: class {
		constructor(public url: unknown) {}
	},
	SSEClientTransport: class {
		constructor(public url: unknown) {}
	},
}));
vi.mock("$lib/server/urlSafety", () => ({ mcpFetch: () => Promise.resolve(new Response()) }));

const { getClient, retainClient, releaseClient, evictFromPool } = await import("./clientPool");

const SERVER = { name: "Shared", url: "https://shared.example/mcp" };

describe("a pooled client shared by two conversations", () => {
	beforeEach(() => {
		built.clients.length = 0;
	});

	it("is not closed out from under a call another conversation is still making", async () => {
		const client = await getClient(SERVER);
		// Conversation B is mid-call on the same pooled connection.
		retainClient(client);

		// Conversation A decides the connection looks broken.
		const evicted = evictFromPool(SERVER);

		// A gets nothing to close, so B's call survives.
		expect(evicted).toBeUndefined();
		expect((client as unknown as { closed: boolean }).closed).toBe(false);

		// The next caller gets a fresh connection rather than the retired one.
		const replacement = await getClient(SERVER);
		expect(replacement).not.toBe(client);

		// B finishes, and only then is the retired connection closed.
		releaseClient(client);
		await vi.waitFor(() => expect((client as unknown as { closed: boolean }).closed).toBe(true));
	});

	it("hands back an idle client so the caller can close it", async () => {
		const client = await getClient(SERVER);

		const evicted = evictFromPool(SERVER);

		expect(evicted).toBe(client);
	});
});
