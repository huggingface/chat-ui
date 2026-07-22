import { describe, it, expect, afterEach } from "vitest";
import { env } from "$env/dynamic/private";
import { isValidUrl } from "./urlSafety";

describe("isValidUrl", () => {
	it("allows normal HTTPS URLs", () => {
		expect(isValidUrl("https://example.com")).toBe(true);
		expect(isValidUrl("https://huggingface.co/docs")).toBe(true);
	});

	it("rejects HTTP URLs", () => {
		expect(isValidUrl("http://example.com")).toBe(false);
		expect(isValidUrl("http://169.254.170.23/v1/credentials")).toBe(false);
	});

	it("rejects localhost", () => {
		expect(isValidUrl("https://localhost")).toBe(false);
		expect(isValidUrl("https://localhost:3000")).toBe(false);
	});

	it("rejects private/internal IPs", () => {
		expect(isValidUrl("https://127.0.0.1")).toBe(false);
		expect(isValidUrl("https://192.168.1.1")).toBe(false);
		expect(isValidUrl("https://172.16.0.1")).toBe(false);
		expect(isValidUrl("https://169.254.170.23")).toBe(false);
	});

	it("allows 10.0.0.0/8 (used by internal LBs in cluster)", () => {
		expect(isValidUrl("https://10.0.0.1")).toBe(true);
		expect(isValidUrl("https://10.0.240.151")).toBe(true);
	});

	it("rejects non-URL strings", () => {
		expect(isValidUrl("not-a-url")).toBe(false);
		expect(isValidUrl("")).toBe(false);
		expect(isValidUrl("ftp://example.com")).toBe(false);
	});
});

describe("isValidUrl with the MCP_ALLOW_INSECURE_URLS escape hatch", () => {
	const LOCAL_MCP = "http://127.0.0.1:8789/mcp";
	const original = env.MCP_ALLOW_INSECURE_URLS;

	afterEach(() => {
		env.MCP_ALLOW_INSECURE_URLS = original;
	});

	it("stays strict when the flag is unset, even for callers that opt in", () => {
		expect(env.MCP_ALLOW_INSECURE_URLS).toBeFalsy();
		expect(isValidUrl(LOCAL_MCP, { allowInsecure: true })).toBe(false);
		expect(isValidUrl("https://localhost:3000", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("https://192.168.1.1", { allowInsecure: true })).toBe(false);
	});

	it("only honours the literal string 'true'", () => {
		for (const value of ["1", "yes", "TRUE", ""]) {
			env.MCP_ALLOW_INSECURE_URLS = value;
			expect(isValidUrl(LOCAL_MCP, { allowInsecure: true })).toBe(false);
		}
	});

	it("allows http, localhost and private ranges for opted-in callers when set", () => {
		env.MCP_ALLOW_INSECURE_URLS = "true";
		expect(isValidUrl(LOCAL_MCP, { allowInsecure: true })).toBe(true);
		expect(isValidUrl("http://localhost:8789/mcp", { allowInsecure: true })).toBe(true);
		expect(isValidUrl("https://192.168.1.1", { allowInsecure: true })).toBe(true);
		expect(isValidUrl("http://[::1]:8789/mcp", { allowInsecure: true })).toBe(true);
	});

	it("leaves callers that do not opt in strict even when set", () => {
		env.MCP_ALLOW_INSECURE_URLS = "true";
		expect(isValidUrl(LOCAL_MCP)).toBe(false);
		expect(isValidUrl("http://example.com")).toBe(false);
		expect(isValidUrl("https://localhost:3000")).toBe(false);
		expect(isValidUrl("https://169.254.170.23")).toBe(false);
	});

	it("still rejects non-http(s) schemes and junk when set", () => {
		env.MCP_ALLOW_INSECURE_URLS = "true";
		expect(isValidUrl("ftp://127.0.0.1", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("file:///etc/passwd", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("not-a-url", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("", { allowInsecure: true })).toBe(false);
	});
});
