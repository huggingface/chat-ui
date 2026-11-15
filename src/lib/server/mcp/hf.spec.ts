import { describe, it, expect } from "vitest";
import { isExaMcpServer, isHfMcpServer, isStrictHfMcpLogin, redactSecret } from "./hf";

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

describe("isExaMcpServer", () => {
	it("matches the Exa MCP endpoint", () => {
		expect(isExaMcpServer("https://mcp.exa.ai/mcp")).toBe(true);
		expect(isExaMcpServer("https://MCP.exa.ai/mcp?tools=web_search_exa")).toBe(true);
		expect(isExaMcpServer("https://mcp.exa.ai:443/mcp")).toBe(true);
	});

	it("rejects URLs that would leak the injected key through a fetch error", () => {
		expect(isExaMcpServer("https://1:1@mcp.exa.ai/mcp")).toBe(false);
		expect(isExaMcpServer("https://user@mcp.exa.ai/mcp")).toBe(false);
		expect(isExaMcpServer("https://:pass@mcp.exa.ai/mcp")).toBe(false);
		expect(isExaMcpServer("https://mcp.exa.ai:8443/mcp")).toBe(false);
	});

	it("rejects everything else", () => {
		expect(isExaMcpServer("http://mcp.exa.ai/mcp")).toBe(false);
		expect(isExaMcpServer("https://mcp.exa.ai.evil.example/mcp")).toBe(false);
		expect(isExaMcpServer("not a url")).toBe(false);
	});
});

describe("redactSecret", () => {
	it("replaces the raw and URL-encoded secret", () => {
		expect(redactSecret("https://mcp.exa.ai/mcp?exaApiKey=k/1", "k/1")).toBe(
			"https://mcp.exa.ai/mcp?exaApiKey=[redacted]"
		);
		expect(redactSecret("https://mcp.exa.ai/mcp?exaApiKey=k%2F1", "k/1")).toBe(
			"https://mcp.exa.ai/mcp?exaApiKey=[redacted]"
		);
	});

	it("replaces the secret as URLSearchParams serializes it", () => {
		const url = new URL("https://mcp.exa.ai/mcp");
		url.searchParams.set("exaApiKey", "a b!c");
		expect(redactSecret(url.toString(), "a b!c")).toBe(
			"https://mcp.exa.ai/mcp?exaApiKey=[redacted]"
		);
	});

	it("leaves text alone when there is no secret", () => {
		expect(redactSecret("https://mcp.exa.ai/mcp", undefined)).toBe("https://mcp.exa.ai/mcp");
		expect(redactSecret("https://mcp.exa.ai/mcp", " ")).toBe("https://mcp.exa.ai/mcp");
	});
});
