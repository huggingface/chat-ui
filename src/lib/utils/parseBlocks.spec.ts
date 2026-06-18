import { describe, expect, test } from "vitest";
import { parseMarkdownIntoBlocks } from "./parseBlocks";

describe("parseMarkdownIntoBlocks", () => {
	describe("basic splitting", () => {
		test("splits paragraphs into separate blocks", () => {
			const blocks = parseMarkdownIntoBlocks("First paragraph.\n\nSecond paragraph.");
			const content = blocks.filter((b) => b.trim().length > 0);
			expect(content).toHaveLength(2);
			expect(content[0]).toContain("First paragraph.");
			expect(content[1]).toContain("Second paragraph.");
		});

		test("reassembles the original document exactly", () => {
			const markdown = "# Title\n\nSome text with **bold**.\n\n```js\nconst x = 1;\n```\n\nEnd.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			expect(blocks.join("")).toBe(markdown);
		});
	});

	describe("footnote detection", () => {
		test("returns a single block when real footnotes are present", () => {
			const markdown = "Here is a footnote[^1].\n\n[^1]: This is the footnote content.\n";
			expect(parseMarkdownIntoBlocks(markdown)).toHaveLength(1);
		});

		test("does not treat regex negated character classes as footnotes", () => {
			const markdown = [
				"# Regex Examples",
				"",
				"Here are some useful regex patterns.",
				"",
				"```perl",
				'https?://[^\\s<>"{}|\\\\^`\\[\\]]+',
				"```",
				"",
				"More text after the code block.",
				"",
			].join("\n");
			expect(parseMarkdownIntoBlocks(markdown).length).toBeGreaterThan(1);
		});

		test("does not match short regex classes like [^>] as footnotes", () => {
			const markdown = [
				"# Parser Code",
				"",
				"Some explanation.",
				"",
				"```js",
				"const regex = /[^>]+/;",
				"const other = /[^)]/;",
				"```",
				"",
				"End of document.",
				"",
			].join("\n");
			expect(parseMarkdownIntoBlocks(markdown).length).toBeGreaterThan(1);
		});
	});

	describe("HTML block handling", () => {
		test("void elements like <br> do not swallow subsequent blocks", () => {
			const markdown = "First paragraph.\n\n<br>\n\nSecond paragraph.\n\nThird paragraph.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const second = blocks.find((b) => b.includes("Second paragraph."));
			expect(second).toBeTruthy();
			expect(second).not.toContain("Third paragraph.");
		});

		test("self-closing tags like <div /> do not swallow subsequent blocks", () => {
			const markdown = "<div />\n\nNext paragraph.\n\nAnother paragraph.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const next = blocks.find((b) => b.includes("Next paragraph."));
			expect(next).toBeTruthy();
			expect(next).not.toContain("Another paragraph.");
		});

		test("keeps an unclosed HTML element in one block until it closes", () => {
			const markdown = "<div>\nFirst part\n\nMiddle part\n\n</div>\n\nAfter.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const htmlBlock = blocks.find((b) => b.includes("<div>"));
			expect(htmlBlock).toContain("Middle part");
			expect(htmlBlock).toContain("</div>");
			expect(htmlBlock).not.toContain("After.");
		});

		test("nested same-tag elements are not closed prematurely", () => {
			const markdown = "<div>\nA\n\n<div>\nB\n</div>\n\nC\n</div>\n\nAfter.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const htmlBlock = blocks.find((b) => b.includes("<div>"));
			expect(htmlBlock).toContain("A");
			expect(htmlBlock).toContain("B");
			expect(htmlBlock).toContain("C");
			expect(htmlBlock).not.toContain("After.");
			const after = blocks.find((b) => b.includes("After."));
			expect(after).toBeTruthy();
		});
	});

	describe("math block handling", () => {
		test("keeps a math block with its closing $$ in one block", () => {
			const markdown = "Some text.\n\n$$\nx = y + z\n$$\n\nMore text.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const mathBlock = blocks.find((b) => b.includes("$$") && b.includes("x = y"));
			expect(mathBlock).toBeTruthy();
			expect((mathBlock?.match(/\$\$/g) || []).length).toBe(2);
		});

		test("merges math blocks split by setext-like lines (= on its own line)", () => {
			const markdown = "Before.\n\n$$\nE\n=\nmc^2\n$$\n\nAfter.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const mathBlock = blocks.find((b) => b.includes("mc^2"));
			expect(mathBlock).toBeTruthy();
			expect((mathBlock?.match(/\$\$/g) || []).length).toBe(2);
			const after = blocks.find((b) => b.includes("After."));
			expect(after).toBeTruthy();
			expect(after).not.toContain("mc^2");
		});

		test("does not treat $$ inside code blocks as math delimiters", () => {
			const markdown = "```bash\n# Process tree\npstree -p $$\necho $$\n```\n\nSome text after.";
			const blocks = parseMarkdownIntoBlocks(markdown);
			expect(blocks.length).toBeGreaterThan(1);
			const codeBlock = blocks.find((b) => b.includes("```"));
			expect(codeBlock).toContain("pstree -p $$");
			expect(codeBlock).not.toContain("Some text after.");
			expect(blocks.find((b) => b.trim() === "$$")).toBeUndefined();
		});

		test("handles a code block followed by a math block", () => {
			const markdown = "```bash\necho $$\n```\n\n$$\nmath here\n$$";
			const blocks = parseMarkdownIntoBlocks(markdown);
			const codeBlock = blocks.find((b) => b.includes("```") && b.includes("echo $$"));
			expect(codeBlock).toBeTruthy();
			const mathBlock = blocks.find((b) => b.trim().startsWith("$$") && b.includes("math here"));
			expect(mathBlock).toBeTruthy();
		});
	});

	describe("streaming stability", () => {
		test("completed blocks stay byte-identical as the document grows", () => {
			const doc = [
				"Paragraph one with some text.",
				"Paragraph two with **bold** and `code`.",
				"```js\nconst x = 1;\nconst y = 2;\n```",
				"A final paragraph at the end.",
			].join("\n\n");

			const finalBlocks = parseMarkdownIntoBlocks(doc);

			for (let i = 1; i <= doc.length; i++) {
				const partialBlocks = parseMarkdownIntoBlocks(doc.slice(0, i));
				// All blocks except the in-flight last one must already match the final
				// parse, otherwise memoization breaks and blocks re-render while streaming.
				for (let b = 0; b < partialBlocks.length - 1; b++) {
					expect(partialBlocks[b]).toBe(finalBlocks[b]);
				}
			}
		});
	});
});
