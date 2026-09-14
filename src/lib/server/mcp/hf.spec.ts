import { describe, it, expect } from "vitest";
import { isHfMcpServer, isStrictHfMcpLogin } from "./hf";

describe("isHfMcpServer", () => {
	it("matches the Hub MCP endpoint in every spelling that dispatches", () => {
		expect(isHfMcpServer("https://hf.co/mcp")).toBe(true);
		expect(isHfMcpServer("https://hf.co/mcp?login")).toBe(true);
		expect(isHfMcpServer("https://huggingface.co/mcp")).toBe(true);
		expect(isHfMcpServer("https://huggingface.co/mcp?login&bouquet=intern")).toBe(true);
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
	it("matches the login endpoint, with or without a bouquet", () => {
		expect(isStrictHfMcpLogin("https://hf.co/mcp?login")).toBe(true);
		expect(isStrictHfMcpLogin("https://huggingface.co/mcp?login")).toBe(true);
		// A bouquet only selects among the server's own tool presets, so it
		// cannot move a forwarded token anywhere else.
		expect(isStrictHfMcpLogin("https://huggingface.co/mcp?login&bouquet=intern")).toBe(true);
		expect(isStrictHfMcpLogin("https://hf.co/mcp?bouquet=intern&login")).toBe(true);
		expect(isStrictHfMcpLogin("https://hf.co/mcp?login=&bouquet=intern")).toBe(true);
	});

	it("fails closed on anything else — it gates token forwarding", () => {
		expect(isStrictHfMcpLogin("https://hf.co/mcp/?login")).toBe(false);
		expect(isStrictHfMcpLogin("https://hf.co/mcp")).toBe(false);
		expect(isStrictHfMcpLogin("http://hf.co/mcp?login")).toBe(false);
		expect(isStrictHfMcpLogin("https://hf.co.evil.example/mcp?login")).toBe(false);
		// A bouquet alone is not the login endpoint: without `login` the server
		// serves an anonymous caller a reduced set instead of refusing them.
		expect(isStrictHfMcpLogin("https://hf.co/mcp?bouquet=intern")).toBe(false);
		// `gradio` names a Space the server would hand the forwarded token to.
		expect(isStrictHfMcpLogin("https://hf.co/mcp?login&gradio=evil/space")).toBe(false);
		expect(isStrictHfMcpLogin("https://hf.co/mcp?login&mix=proxy")).toBe(false);
	});
});
