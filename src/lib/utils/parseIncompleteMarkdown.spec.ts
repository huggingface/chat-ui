import { describe, expect, test } from "vitest";
import { parseIncompleteMarkdown } from "./parseIncompleteMarkdown";

describe("parseIncompleteMarkdown (remend)", () => {
	describe("marker completion", () => {
		test("completes incomplete bold", () => {
			expect(parseIncompleteMarkdown("**hello")).toBe("**hello**");
		});

		test("completes incomplete italic", () => {
			expect(parseIncompleteMarkdown("*hello")).toBe("*hello*");
		});

		test("completes incomplete inline code", () => {
			expect(parseIncompleteMarkdown("`code")).toBe("`code`");
		});

		test("completes incomplete strikethrough", () => {
			expect(parseIncompleteMarkdown("~~text")).toBe("~~text~~");
		});

		test("completes incomplete block math", () => {
			expect(parseIncompleteMarkdown("$$\nx = 1")).toBe("$$\nx = 1\n$$");
		});

		test("completes a partial closing $ of block math with a single $", () => {
			expect(parseIncompleteMarkdown("$$E=mc^2$")).toBe("$$E=mc^2$$");
		});
	});

	describe("links and images", () => {
		test("closes incomplete link text with placeholder URL", () => {
			expect(parseIncompleteMarkdown("[link tex")).toBe("[link tex](streamdown:incomplete-link)");
		});

		test("replaces incomplete link URL with placeholder", () => {
			expect(parseIncompleteMarkdown("[text](https://exa")).toBe(
				"[text](streamdown:incomplete-link)"
			);
		});

		test("removes images with incomplete URLs", () => {
			const result = parseIncompleteMarkdown("before ![alt](https://x");
			expect(result).not.toContain("![");
			expect(result).toContain("before");
		});

		test("leaves complete links untouched", () => {
			const input = "[link](https://example.com) end";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});
	});

	describe("streaming flash guards", () => {
		test("breaks a potential setext heading underline with a zero-width space", () => {
			// Without this, "Some text" would flash as an <h2> while a list item streams in
			expect(parseIncompleteMarkdown("Some text\n-")).toBe("Some text\n-​");
		});

		test("escapes single tildes between word characters (no false strikethrough)", () => {
			expect(parseIncompleteMarkdown("Temperature is 20~25°C")).toBe("Temperature is 20\\~25°C");
		});

		test("escapes > used as comparison operator in list items (no blockquote)", () => {
			expect(parseIncompleteMarkdown("- > 25: high")).toBe("- \\> 25: high");
		});

		test("strips a half-typed trailing HTML tag", () => {
			expect(parseIncompleteMarkdown("Hello <div cla")).toBe("Hello");
		});

		test("keeps complete HTML tags", () => {
			const input = "Hello <b>hi</b>";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});
	});

	describe("false-positive protection", () => {
		test("does not close emphasis markers inside a complete inline code span", () => {
			const input = "`**bold`";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});

		test("does not treat $$ inside inline code as math", () => {
			const input = "run `echo $$` now";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});

		test("does not complete a lone $ (currency, inlineKatex disabled)", () => {
			const input = "I have $20";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});

		test("does not treat asterisks inside math blocks as italics", () => {
			const input = "$$a * b$$ and more";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});

		test("does not append underscores to word-internal underscores", () => {
			const input = "snake_case_name";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});

		test("does not complete markers inside an open code fence", () => {
			const input = "```js\nconst a = b ** 2;\nconst c = a **";
			expect(parseIncompleteMarkdown(input)).toBe(input);
		});
	});

	describe("whitespace handling", () => {
		test("removes a single trailing space (mid-word streaming)", () => {
			expect(parseIncompleteMarkdown("hello ")).toBe("hello");
		});

		test("preserves a double trailing space (markdown line break)", () => {
			expect(parseIncompleteMarkdown("hello  ")).toBe("hello  ");
		});
	});

	describe("input edge cases", () => {
		test("returns empty string unchanged", () => {
			expect(parseIncompleteMarkdown("")).toBe("");
		});

		test("returns plain text unchanged", () => {
			expect(parseIncompleteMarkdown("just some plain text")).toBe("just some plain text");
		});
	});
});
