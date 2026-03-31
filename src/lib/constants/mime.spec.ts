import { describe, expect, it } from "vitest";
import { parseTextMimeAllowlist } from "./mime";

describe("parseTextMimeAllowlist", () => {
	it("returns default values when unset", () => {
		expect(parseTextMimeAllowlist(undefined)).toEqual([
			"text/*",
			"application/json",
			"application/xml",
			"application/csv",
		]);
	});

	it("parses comma-separated values, trims whitespace, lowercases, and deduplicates", () => {
		expect(parseTextMimeAllowlist(" text/plain,application/json,Text/Plain ")).toEqual([
			"text/plain",
			"application/json",
		]);
	});

	it("falls back to defaults when only empty items are provided", () => {
		expect(parseTextMimeAllowlist(" ,  , ")).toEqual([
			"text/*",
			"application/json",
			"application/xml",
			"application/csv",
		]);
	});
});
