import { describe, it, expect } from "vitest";
import { isHfMcpServer, isStrictHfMcpLogin } from "./hf";

describe("isHfMcpServer", () => {
	it("matches the Hub MCP endpoint in every spelling that dispatches", () => {
		expect(isHfMcpServer("https://hf.co/mcp")).toBe(true);
		expect(isHfMcpServer("https://hf.co/mcp?login")).toBe(true);
		expect(isHfMcpServer("https://huggingface.co/mcp")).toBe(true);
		// A trailing slash dispatches tools like the bare path; treating it as
		// not-the-Hub would route job submissions around the budget gate.
		expect(isHfMcpServer("https://hf.co/mcp/")).toBe(true);
		expect(isHfMcpServer("https://hf.co/mcp//")).toBe(true);
	});

	it("rejects everything else", () => {
		expect(isHfMcpServer("http://hf.co/mcp")).toBe(false);
		expect(isHfMcpServer("https://hf.co/mcp/extra")).toBe(false);
		expect(isHfMcpServer("https://evil.example/mcp")).toBe(false);
		expect(isHfMcpServer("https://hf.co.evil.example/mcp")).toBe(false);
		expect(isHfMcpServer("not a url")).toBe(false);
	});
});

describe("isStrictHfMcpLogin", () => {
	it("stays exact — it gates token forwarding, where failing closed is safe", () => {
		expect(isStrictHfMcpLogin("https://hf.co/mcp?login")).toBe(true);
		expect(isStrictHfMcpLogin("https://hf.co/mcp/?login")).toBe(false);
		expect(isStrictHfMcpLogin("https://hf.co/mcp")).toBe(false);
	});
});
