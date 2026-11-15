import { describe, expect, it } from "vitest";
import { isSameServerUrl } from "./mcpValidation";

describe("isSameServerUrl", () => {
	it("matches URLs that differ only in spelling", () => {
		expect(isSameServerUrl("https://Host.example/mcp", "https://host.example:443/mcp")).toBe(true);
	});

	it("ignores fragments, which are never sent to the server", () => {
		expect(isSameServerUrl("https://host.example/mcp", "https://host.example/mcp#tools")).toBe(
			true
		);
	});

	it("tells different endpoints apart", () => {
		expect(isSameServerUrl("https://host.example/mcp", "https://host.example/mcp/")).toBe(false);
		expect(isSameServerUrl("https://host.example/mcp", "https://host.example/mcp?a=1")).toBe(false);
		expect(isSameServerUrl("https://host.example/mcp", "not a url")).toBe(false);
	});
});
