import { describe, it, expect, afterEach } from "vitest";
import { env } from "$env/dynamic/private";
import { isValidUrl, ssrfSafeFetch } from "./urlSafety";

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

	// The URL parser canonicalises `::ffff:127.0.0.1` to its hex form `::ffff:7f00:1`, which
	// ip-address's `is4()` does not recognise — so every mapped address used to slip through.
	it("rejects IPv4-mapped IPv6 addresses in either textual form", () => {
		expect(isValidUrl("https://[::ffff:127.0.0.1]")).toBe(false);
		expect(isValidUrl("https://[::ffff:7f00:1]")).toBe(false);
		expect(isValidUrl("https://[::ffff:169.254.169.254]")).toBe(false);
		expect(isValidUrl("https://[::ffff:a9fe:a9fe]")).toBe(false);
	});

	it("rejects IPv6 loopback, link-local and unspecified addresses", () => {
		expect(isValidUrl("https://[::1]")).toBe(false);
		expect(isValidUrl("https://[fe80::1]")).toBe(false);
		expect(isValidUrl("https://[::]")).toBe(false);
	});

	// Unique local addresses are the IPv6 counterpart of 192.168/172.16 (which we block);
	// unlike 10.0.0.0/8, no internal infra depends on them.
	it("rejects IPv6 unique local addresses (fc00::/7)", () => {
		expect(isValidUrl("https://[fc00::1]")).toBe(false);
		expect(isValidUrl("https://[fd12:3456::1]")).toBe(false);
	});

	it("rejects obfuscated IPv4 notations", () => {
		// The URL parser normalises all of these to 127.0.0.1.
		expect(isValidUrl("https://2130706433")).toBe(false);
		expect(isValidUrl("https://0177.0.0.1")).toBe(false);
		expect(isValidUrl("https://127.1")).toBe(false);
	});

	it("still allows IPv4-mapped public addresses", () => {
		expect(isValidUrl("https://[::ffff:8.8.8.8]")).toBe(true);
	});
});

describe("ssrfSafeFetch", () => {
	// undici only calls the agent's `lookup` hook for hosts needing DNS resolution, so IP
	// literals reached the network without any safety check until the host was validated
	// up-front. These must fail closed before a connection is attempted.
	it.each([
		["IPv4 loopback", "http://127.0.0.1:9911/"],
		["IPv6 loopback", "http://[::1]:9911/"],
		["IPv4-mapped loopback", "http://[::ffff:7f00:1]:9911/"],
		["link-local metadata endpoint", "http://169.254.169.254/latest/meta-data/"],
		["unspecified IPv4", "http://0.0.0.0:9911/"],
		["unspecified IPv6", "http://[::]:9911/"],
		["IPv6 unique local address", "http://[fd12:3456::1]:9911/"],
		["obfuscated decimal loopback", "http://2130706433:9911/"],
	])("blocks %s", async (_label, url) => {
		await expect(ssrfSafeFetch(url)).rejects.toThrow(/unsafe IP \(SSRF\)/);
	});

	it("blocks unsafe literals regardless of the caller's redirect mode", async () => {
		await expect(ssrfSafeFetch("http://127.0.0.1:9911/", { redirect: "manual" })).rejects.toThrow(
			/unsafe IP \(SSRF\)/
		);
		await expect(ssrfSafeFetch("http://127.0.0.1:9911/", { redirect: "error" })).rejects.toThrow(
			/unsafe IP \(SSRF\)/
		);
	});

	it("does not reject hostnames at the literal check", async () => {
		// `.invalid` never resolves (RFC 2606), so this fails at DNS — but it must not be
		// rejected by the IP-literal guard, which would mean we over-block real hostnames.
		await expect(ssrfSafeFetch("https://nonexistent.invalid/")).rejects.not.toThrow(
			/unsafe IP \(SSRF\)/
		);
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
		expect(isValidUrl("http://10.0.0.1:8789/mcp", { allowInsecure: true })).toBe(true);
		expect(isValidUrl("http://172.16.0.1:8789/mcp", { allowInsecure: true })).toBe(true);
	});

	it("keeps public hosts on the strict path when set", () => {
		env.MCP_ALLOW_INSECURE_URLS = "true";
		expect(isValidUrl("http://example.com/mcp", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("http://mcp.exa.ai/mcp", { allowInsecure: true })).toBe(false);
		// Unchanged by the flag, not granted by it.
		expect(isValidUrl("https://example.com/mcp", { allowInsecure: true })).toBe(true);
	});

	it("keeps link-local, 0.0.0.0/8 and CGNAT blocked when set, over either scheme", () => {
		env.MCP_ALLOW_INSECURE_URLS = "true";
		expect(isValidUrl("http://169.254.169.254/latest/meta-data/", { allowInsecure: true })).toBe(
			false
		);
		expect(isValidUrl("https://169.254.170.23/v1/credentials", { allowInsecure: true })).toBe(
			false
		);
		expect(isValidUrl("http://[fe80::1]/mcp", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("http://0.0.0.0:8789/mcp", { allowInsecure: true })).toBe(false);
		expect(isValidUrl("http://100.64.0.1:8789/mcp", { allowInsecure: true })).toBe(false);
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
