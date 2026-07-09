import { describe, expect, it } from "vitest";
import { promptFromLinkParams, sanitizeUrlParam, MAX_PARAM_LENGTH } from "./urlParams";

const params = (init: Record<string, string>) => new URLSearchParams(init);

describe("sanitizeUrlParam", () => {
	it("trims surrounding whitespace", () => {
		expect(sanitizeUrlParam("  hello  ")).toBe("hello");
	});

	it("returns null for null, empty, and whitespace-only input", () => {
		expect(sanitizeUrlParam(null)).toBeNull();
		expect(sanitizeUrlParam("")).toBeNull();
		expect(sanitizeUrlParam("   ")).toBeNull();
	});

	it("returns null past the length cap", () => {
		expect(sanitizeUrlParam("a".repeat(MAX_PARAM_LENGTH))).not.toBeNull();
		expect(sanitizeUrlParam("a".repeat(MAX_PARAM_LENGTH + 1))).toBeNull();
	});
});

describe("promptFromLinkParams", () => {
	it("reads ?q=", () => {
		expect(promptFromLinkParams(params({ q: "how do I bake bread?" }))).toBe(
			"how do I bake bread?"
		);
	});

	it("reads ?prompt=", () => {
		expect(promptFromLinkParams(params({ prompt: "write me a poem" }))).toBe("write me a poem");
	});

	it("prefers ?q= over ?prompt= (matches the home page's consumption order)", () => {
		expect(promptFromLinkParams(params({ q: "query wins", prompt: "ignored" }))).toBe("query wins");
	});

	it("falls back to ?prompt= when ?q= is blank", () => {
		expect(promptFromLinkParams(params({ q: "   ", prompt: "fallback" }))).toBe("fallback");
	});

	it("trims the resolved value", () => {
		expect(promptFromLinkParams(params({ q: "  spaced  " }))).toBe("spaced");
	});

	it("returns an empty string when neither param is usable", () => {
		expect(promptFromLinkParams(params({}))).toBe("");
		expect(promptFromLinkParams(params({ q: "", prompt: "  " }))).toBe("");
		expect(promptFromLinkParams(params({ other: "x" }))).toBe("");
	});

	it("ignores over-long values", () => {
		expect(promptFromLinkParams(params({ q: "a".repeat(MAX_PARAM_LENGTH + 1) }))).toBe("");
	});
});
