import { describe, expect, it } from "vitest";
import { canonicalizeMcpUri } from "./canonical";

describe("canonicalizeMcpUri", () => {
	it("matches RFC 8707 examples from the MCP spec", () => {
		expect(canonicalizeMcpUri("https://mcp.example.com/mcp")).toBe("https://mcp.example.com/mcp");
		expect(canonicalizeMcpUri("https://mcp.example.com")).toBe("https://mcp.example.com");
		expect(canonicalizeMcpUri("https://mcp.example.com:8443")).toBe("https://mcp.example.com:8443");
		expect(canonicalizeMcpUri("https://mcp.example.com/server/mcp")).toBe(
			"https://mcp.example.com/server/mcp"
		);
	});

	it("rejects fragments", () => {
		expect(() => canonicalizeMcpUri("https://mcp.example.com/mcp#tools")).toThrow(/fragment/);
	});

	it("normalizes trailing slash on bare host", () => {
		expect(canonicalizeMcpUri("https://mcp.example.com/")).toBe("https://mcp.example.com");
	});

	it("preserves a semantically significant trailing slash on a path", () => {
		expect(canonicalizeMcpUri("https://mcp.example.com/mcp/")).toBe("https://mcp.example.com/mcp/");
	});

	it("lowercases scheme and host", () => {
		expect(canonicalizeMcpUri("HTTPS://MCP.Example.COM/MCP")).toBe("https://mcp.example.com/MCP");
	});

	it("preserves query string", () => {
		expect(canonicalizeMcpUri("https://huggingface.co/mcp?login")).toBe(
			"https://huggingface.co/mcp?login"
		);
	});

	it("rejects non-HTTP(S) schemes", () => {
		expect(() => canonicalizeMcpUri("javascript:alert(1)")).toThrow();
		expect(() => canonicalizeMcpUri("ftp://example.com")).toThrow();
	});

	it("rejects URL credentials", () => {
		const url = new URL("https://mcp.example.com/mcp");
		url.username = "user";
		url.password = "pass";

		expect(() => canonicalizeMcpUri(url.toString())).toThrow(/credentials/);
	});
});
