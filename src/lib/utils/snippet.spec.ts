import { describe, expect, it } from "vitest";
import { buildSnippet } from "./snippet";

describe("buildSnippet", () => {
	it("returns empty matchedText when query is empty", () => {
		const { snippet, matchedText } = buildSnippet("hello world", "");
		expect(matchedText).toBe("");
		expect(snippet).toBe("hello world");
	});

	it("returns empty matchedText when text has no match", () => {
		const { matchedText } = buildSnippet("hello world", "octopus");
		expect(matchedText).toBe("");
	});

	it("matches case-insensitively and preserves original casing in matchedText", () => {
		const { matchedText } = buildSnippet("I saw an Octopus today", "octo");
		expect(matchedText).toBe("Octo");
	});

	it("normalizes diacritics for matching", () => {
		const { matchedText } = buildSnippet("Le café est ouvert", "cafe");
		expect(matchedText).toBe("café");
	});

	it("adds leading ellipsis when the match is past the head", () => {
		const long = "lorem ipsum ".repeat(20) + "OCTOPUS " + "dolor sit ".repeat(20);
		const { snippet } = buildSnippet(long, "octopus");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet).toContain("OCTOPUS");
	});

	it("respects maxLen", () => {
		const long = "x".repeat(500) + " needle " + "y".repeat(500);
		const { snippet } = buildSnippet(long, "needle", 80);
		expect(snippet.length).toBeLessThanOrEqual(82);
	});
});
