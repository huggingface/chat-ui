import { describe, it, expect } from "vitest";
import { sanitizeUtf8, sanitizeUtf8Deep } from "./sanitizeString";

describe("sanitizeUtf8", () => {
	it("passes through valid ASCII unchanged", () => {
		expect(sanitizeUtf8("hello world")).toBe("hello world");
	});

	it("passes through valid UTF-8 (Korean) unchanged", () => {
		const korean = "안녕하세요";
		expect(sanitizeUtf8(korean)).toBe(korean);
	});

	it("passes through valid emoji unchanged", () => {
		const emoji = "🎉🤖";
		expect(sanitizeUtf8(emoji)).toBe(emoji);
	});

	it("replaces a lone high surrogate with U+FFFD", () => {
		// \uD800 is a lone (unpaired) high surrogate — invalid in UTF-16
		const withSurrogate = "\uD800test";
		const result = sanitizeUtf8(withSurrogate);
		expect(result).not.toContain("\uD800");
		// The surrogate is replaced with U+FFFD
		expect(result).toBe("�test");
	});

	it("replaces a lone low surrogate with U+FFFD", () => {
		const withSurrogate = "test\uDFFF";
		const result = sanitizeUtf8(withSurrogate);
		expect(result).not.toContain("\uDFFF");
		expect(result).toBe("test�");
	});

	it("preserves a valid surrogate pair (emoji)", () => {
		// U+1F600 GRINNING FACE — encoded as a surrogate pair in JS strings
		const emoji = "😀";
		expect(sanitizeUtf8(emoji)).toBe(emoji);
	});

	it("handles an empty string", () => {
		expect(sanitizeUtf8("")).toBe("");
	});

	it("handles mixed valid and invalid sequences", () => {
		const mixed = "hello \uD800 world 😀";
		const result = sanitizeUtf8(mixed);
		expect(result).toBe("hello � world 😀");
	});
});

describe("sanitizeUtf8Deep", () => {
	it("sanitizes a lone surrogate buried in a nested array of update objects", () => {
		const updates = [
			{ type: "status", status: "started" },
			{
				type: "tool",
				result: { content: "tool output \uD800 with surrogate", nested: ["a", "b\uDFFF"] },
			},
			{ type: "finalAnswer", text: "done\uD800" },
		];
		const result = sanitizeUtf8Deep(updates);
		expect(result).toEqual([
			{ type: "status", status: "started" },
			{
				type: "tool",
				result: { content: "tool output � with surrogate", nested: ["a", "b�"] },
			},
			{ type: "finalAnswer", text: "done�" },
		]);
	});

	it("passes through non-string primitives and Date instances unchanged", () => {
		const date = new Date("2024-01-01T00:00:00.000Z");
		const value = { count: 5, enabled: true, missing: null, when: date };
		const result = sanitizeUtf8Deep(value);
		expect(result).toEqual(value);
		expect(result.when).toBe(date);
	});

	it("handles plain strings and empty arrays/objects", () => {
		expect(sanitizeUtf8Deep("test\uD800")).toBe("test�");
		expect(sanitizeUtf8Deep([])).toEqual([]);
		expect(sanitizeUtf8Deep({})).toEqual({});
	});
});
