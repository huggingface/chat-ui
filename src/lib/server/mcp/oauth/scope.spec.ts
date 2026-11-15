import { describe, expect, it } from "vitest";
import { mergeOAuthScopes, normalizeOAuthScope, selectInitialOAuthScope } from "./scope";

describe("MCP OAuth scope selection", () => {
	it("treats the WWW-Authenticate challenge as authoritative", () => {
		expect(selectInitialOAuthScope("files:read", ["tools:read", "tools:write"])).toBe("files:read");
	});

	it("falls back to protected-resource metadata scopes", () => {
		expect(selectInitialOAuthScope(undefined, ["tools:read", "tools:write"])).toBe(
			"tools:read tools:write"
		);
		expect(selectInitialOAuthScope(undefined, undefined)).toBeUndefined();
	});

	it("merges existing and step-up scopes without duplicates", () => {
		expect(mergeOAuthScopes("files:read profile", "files:write files:read")).toBe(
			"files:read profile files:write"
		);
	});

	it("rejects malformed or unreasonably large challenges", () => {
		expect(() => normalizeOAuthScope('files:read "admin"')).toThrow(/invalid/);
		expect(() => normalizeOAuthScope("x".repeat(2049))).toThrow(/too large/);
	});
});
