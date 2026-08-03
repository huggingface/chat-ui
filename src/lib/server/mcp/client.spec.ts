import { describe, it, expect, vi } from "vitest";

const constructed = vi.hoisted(() => [] as Array<{ info: unknown; options: unknown }>);

vi.mock("@modelcontextprotocol/sdk/client", () => ({
	Client: class {
		constructor(info: unknown, options: unknown) {
			constructed.push({ info, options });
		}
	},
}));

const { createMcpClient, MCP_CLIENT_CAPABILITIES } = await import("./client");

function infoAndOptionsOf(index: number) {
	return constructed[index] as {
		info: { name: string; version: string };
		options: { capabilities: Record<string, unknown> };
	};
}

describe("createMcpClient", () => {
	it("declares capabilities on every client it builds", () => {
		constructed.length = 0;

		createMcpClient();
		createMcpClient("health");

		// Same declaration everywhere, or which client the server met decides the outcome.
		expect(infoAndOptionsOf(0).options.capabilities).toBe(MCP_CLIENT_CAPABILITIES);
		expect(infoAndOptionsOf(1).options.capabilities).toBe(MCP_CLIENT_CAPABILITIES);
	});

	it("keeps the session and health identities distinct", () => {
		constructed.length = 0;

		createMcpClient("session");
		createMcpClient("health");

		expect(infoAndOptionsOf(0).info).toEqual({ name: "chat-ui-mcp", version: "0.1.0" });
		expect(infoAndOptionsOf(1).info).toEqual({ name: "chat-ui-health-check", version: "1.0.0" });
	});

	it("builds a session client by default", () => {
		constructed.length = 0;

		createMcpClient();

		expect(infoAndOptionsOf(0).info).toEqual({ name: "chat-ui-mcp", version: "0.1.0" });
	});

	it("declares nothing it cannot yet answer", () => {
		expect(MCP_CLIENT_CAPABILITIES).toEqual({});
	});
});
