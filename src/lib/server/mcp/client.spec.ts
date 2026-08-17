import { describe, it, expect, vi, beforeEach } from "vitest";

const constructed = vi.hoisted(
	() => [] as Array<{ info: unknown; options: unknown; handlers: Map<unknown, unknown> }>
);

vi.mock("@modelcontextprotocol/client", () => ({
	Client: class {
		handlers = new Map<unknown, unknown>();
		constructor(info: unknown, options: unknown) {
			constructed.push({ info, options, handlers: this.handlers });
		}
		setRequestHandler(schema: unknown, handler: unknown) {
			this.handlers.set(schema, handler);
		}
	},
}));

const elicitationEnabled = vi.hoisted(() => ({ value: true }));
vi.mock("./elicitationConfig", () => ({
	isElicitationEnabled: () => elicitationEnabled.value,
	getElicitationTimeoutMs: () => 120_000,
}));

const { createMcpClient, mcpClientCapabilities } = await import("./client");

function built(index: number) {
	return constructed[index] as {
		info: { name: string; version: string };
		options: { capabilities: Record<string, unknown> };
		handlers: Map<unknown, unknown>;
	};
}

describe("createMcpClient", () => {
	beforeEach(() => {
		constructed.length = 0;
		elicitationEnabled.value = true;
	});

	it("keeps the session and health identities distinct", () => {
		createMcpClient("session");
		createMcpClient("health");

		expect(built(0).info).toEqual({ name: "chat-ui-mcp", version: "0.1.0" });
		expect(built(1).info).toEqual({ name: "chat-ui-health-check", version: "1.0.0" });
	});

	it("builds a session client by default", () => {
		createMcpClient();

		expect(built(0).info).toEqual({ name: "chat-ui-mcp", version: "0.1.0" });
	});

	it("declares both elicitation modes on session clients", () => {
		// A bare `elicitation: {}` reads as form-only and URL mode is never sent.
		createMcpClient("session");

		expect(built(0).options.capabilities).toEqual({ elicitation: { form: {}, url: {} } });
	});

	it("never declares elicitation to a health probe", () => {
		createMcpClient("health");

		expect(built(0).options.capabilities).toEqual({});
		expect(built(0).handlers.size).toBe(0);
	});

	it("registers a handler for every capability it declares", () => {
		// A capability without a handler gets servers a method-not-found.
		createMcpClient("session");

		expect(Object.keys(built(0).options.capabilities)).toHaveLength(built(0).handlers.size);
	});

	it("declares nothing when elicitation is switched off", () => {
		elicitationEnabled.value = false;

		createMcpClient("session");

		expect(built(0).options.capabilities).toEqual({});
		expect(built(0).handlers.size).toBe(0);
		expect(mcpClientCapabilities("session")).toEqual({});
	});
});
