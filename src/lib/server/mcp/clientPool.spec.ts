import { describe, it, expect, vi, beforeEach } from "vitest";

const built = vi.hoisted(() => ({
	clients: [] as { closed: boolean }[],
	era: "legacy" as "legacy" | "modern",
}));

vi.mock("./client", () => ({
	createMcpClient: (kind = "session") => {
		const client = {
			closed: false,
			kind,
			getProtocolEra: () => built.era,
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

const { getClient, retainClient, releaseClient, evictFromPool, getAttributableClient } =
	await import("./clientPool");

const SERVER = { name: "Shared", url: "https://shared.example/mcp" };

describe("a pooled client shared by two conversations", () => {
	beforeEach(() => {
		built.clients.length = 0;
		built.era = "legacy";
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

describe("a connection a prompt has to be attributed on", () => {
	beforeEach(() => {
		built.clients.length = 0;
		built.era = "legacy";
	});

	it("is per-conversation on a legacy server", async () => {
		const server = { name: "Legacy", url: "https://legacy.example/mcp" };

		const a = await getAttributableClient(server, "conversation-a");
		const b = await getAttributableClient(server, "conversation-b");

		expect(a.client).not.toBe(b.client);
		expect(a.isolation).not.toBe(b.isolation);

		// The same conversation keeps its own connection rather than opening another.
		expect((await getAttributableClient(server, "conversation-a")).client).toBe(a.client);
	});

	it("is shared on a modern server, which answers the call instead of pushing a prompt", async () => {
		built.era = "modern";
		const server = { name: "Modern", url: "https://modern.example/mcp" };

		const a = await getAttributableClient(server, "conversation-a");
		const b = await getAttributableClient(server, "conversation-b");

		expect(a.client).toBe(b.client);
		expect(a.isolation).toBeUndefined();
	});
});

describe("clients of different kinds", () => {
	beforeEach(() => {
		built.clients.length = 0;
		built.era = "modern";
	});

	it("never share a connection, because the name is sent once at initialize", async () => {
		const session = await getClient(SERVER, undefined, undefined, "session");
		const intern = await getClient(SERVER, undefined, undefined, "intern");

		// Handing an intern caller a connection that introduced itself as
		// chat-ui-mcp would report the wrong name for every call it makes.
		expect(intern).not.toBe(session);
		expect((session as unknown as { kind: string }).kind).toBe("session");
		expect((intern as unknown as { kind: string }).kind).toBe("intern");
	});

	it("still pools within a kind", async () => {
		// Its own server: the pool is module-level and outlives a test, so a
		// shared URL would answer from an earlier case's connection.
		const server = { name: "Own", url: "https://pool-within-kind.example/mcp" };

		const first = await getClient(server, undefined, undefined, "intern");
		const second = await getClient(server, undefined, undefined, "intern");

		expect(second).toBe(first);
		expect(built.clients).toHaveLength(1);
	});

	it("keeps the kind when a prompt needs an attributable connection", async () => {
		built.era = "legacy";
		const { client } = await getAttributableClient(SERVER, "conv-1", undefined, "intern");

		expect((client as unknown as { kind: string }).kind).toBe("intern");
	});
});
