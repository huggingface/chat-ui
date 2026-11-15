import { beforeEach, describe, expect, it, vi } from "vitest";

const EXA_KEY = "exa-secret-key-1234";

const logged = vi.hoisted(() => [] as unknown[]);

vi.mock("$lib/server/config", () => ({
	config: { EXA_API_KEY: "exa-secret-key-1234", MCP_FORWARD_HF_USER_TOKEN: "false" },
}));

vi.mock("$lib/server/logger", () => {
	const record = (...args: unknown[]) => logged.push(args);
	return { logger: { info: record, warn: record, error: record, debug: record } };
});

vi.mock("@modelcontextprotocol/client", () => {
	class Transport {
		constructor(readonly url: URL) {}
	}
	return { StreamableHTTPClientTransport: Transport, SSEClientTransport: Transport };
});

// undici rejects a credentialed url with the whole url in its message
vi.mock("$lib/server/mcp/client", () => ({
	createMcpClient: () => ({
		connect: (transport: { url: URL }) =>
			Promise.reject(
				new TypeError(
					`Request cannot be constructed from a URL that includes credentials: ${transport.url}`
				)
			),
		close: async () => {},
	}),
}));

const { POST } = await import("./+server");

async function check(url: string) {
	const response = await POST({
		request: new Request("http://localhost/api/mcp/health", {
			method: "POST",
			body: JSON.stringify({ url }),
		}),
		locals: {},
	} as unknown as Parameters<typeof POST>[0]);
	return { status: response.status, body: await response.text() };
}

function loggedText() {
	return logged
		.flat()
		.map((entry) =>
			entry instanceof Error
				? `${entry.message} ${String(entry.cause instanceof Error ? entry.cause.message : "")}`
				: JSON.stringify(entry, (_k, v) => (v instanceof Error ? v.message : v))
		)
		.join("\n");
}

describe("MCP health check Exa key handling", () => {
	beforeEach(() => {
		logged.length = 0;
	});

	it("does not inject the key into a URL carrying credentials", async () => {
		const { status, body } = await check("https://1:1@mcp.exa.ai/mcp");
		expect(status).toBe(503);
		expect(body).not.toContain(EXA_KEY);
		expect(loggedText()).not.toContain(EXA_KEY);
	});

	it("redacts the injected key from transport errors", async () => {
		const { status, body } = await check("https://mcp.exa.ai/mcp");
		expect(status).toBe(503);
		expect(body).toContain("[redacted]");
		expect(body).not.toContain(EXA_KEY);
		expect(loggedText()).toContain("[redacted]");
		expect(loggedText()).not.toContain(EXA_KEY);
	});
});
