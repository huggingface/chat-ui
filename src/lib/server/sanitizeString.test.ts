import { describe, it, expect } from "vitest";
import { sanitizeUtf8 } from "./sanitizeString";

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
