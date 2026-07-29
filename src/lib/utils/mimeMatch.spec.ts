import { describe, expect, it } from "vitest";
import { mimeMatchesAllowlist } from "./mimeMatch";

describe("mimeMatchesAllowlist", () => {
	it("matches exact types", () => {
		expect(mimeMatchesAllowlist("image/png", ["image/png"])).toBe(true);
		expect(mimeMatchesAllowlist("image/png", ["image/jpeg", "image/png"])).toBe(true);
	});

	it("matches wildcard subtypes", () => {
		expect(mimeMatchesAllowlist("text/plain", ["text/*"])).toBe(true);
		expect(mimeMatchesAllowlist("text/markdown", ["text/*"])).toBe(true);
		expect(mimeMatchesAllowlist("image/png", ["text/*"])).toBe(false);
	});

	it("matches a full wildcard", () => {
		expect(mimeMatchesAllowlist("application/pdf", ["*/*"])).toBe(true);
	});

	it("rejects types not in the allowlist", () => {
		expect(mimeMatchesAllowlist("image/png", ["text/*", "application/json"])).toBe(false);
		expect(mimeMatchesAllowlist("image/svg+xml", ["image/png", "image/jpeg"])).toBe(false);
	});

	it("rejects everything on an empty allowlist", () => {
		expect(mimeMatchesAllowlist("image/png", [])).toBe(false);
	});
});
