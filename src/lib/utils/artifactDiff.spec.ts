import { describe, expect, it } from "vitest";
import { diffLines, diffStats, renderDiffHtml } from "./artifactDiff";

describe("diffLines", () => {
	it("returns only context lines for identical content", () => {
		const lines = diffLines("a\nb\nc", "a\nb\nc");
		expect(lines).toEqual([
			{ type: "context", text: "a" },
			{ type: "context", text: "b" },
			{ type: "context", text: "c" },
		]);
		expect(diffStats(lines)).toEqual({ added: 0, removed: 0 });
	});

	it("emits deletion before addition for a replaced line", () => {
		expect(diffLines("a\nb\nc", "a\nB\nc")).toEqual([
			{ type: "context", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "B" },
			{ type: "context", text: "c" },
		]);
	});

	it("handles pure insertions and deletions", () => {
		expect(diffLines("a\nc", "a\nb\nc")).toEqual([
			{ type: "context", text: "a" },
			{ type: "add", text: "b" },
			{ type: "context", text: "c" },
		]);
		expect(diffLines("a\nb\nc", "a\nc")).toEqual([
			{ type: "context", text: "a" },
			{ type: "del", text: "b" },
			{ type: "context", text: "c" },
		]);
	});

	it("handles changes at the very start and end", () => {
		expect(diffLines("x\nb", "y\nb")).toEqual([
			{ type: "del", text: "x" },
			{ type: "add", text: "y" },
			{ type: "context", text: "b" },
		]);
		expect(diffLines("a\nx", "a\ny")).toEqual([
			{ type: "context", text: "a" },
			{ type: "del", text: "x" },
			{ type: "add", text: "y" },
		]);
	});

	it("keeps unchanged lines between multiple change regions", () => {
		expect(diffLines("a\nb\nc\nd\ne", "a\nB\nc\nd\nE")).toEqual([
			{ type: "context", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "B" },
			{ type: "context", text: "c" },
			{ type: "context", text: "d" },
			{ type: "del", text: "e" },
			{ type: "add", text: "E" },
		]);
	});

	it("ignores a trailing newline difference", () => {
		expect(diffLines("a\nb\n", "a\nb")).toEqual([
			{ type: "context", text: "a" },
			{ type: "context", text: "b" },
		]);
	});

	it("falls back to delete-all/add-all when the changed region is huge", () => {
		const oldText = Array.from({ length: 1100 }, (_, i) => `old ${i}`).join("\n");
		const newText = Array.from({ length: 1100 }, (_, i) => `new ${i}`).join("\n");
		const lines = diffLines(oldText, newText);
		expect(lines).toHaveLength(2200);
		expect(lines.slice(0, 1100).every((l) => l.type === "del")).toBe(true);
		expect(lines.slice(1100).every((l) => l.type === "add")).toBe(true);
	});

	it("counts added and removed lines", () => {
		const lines = diffLines("a\nb", "a\nB\nc");
		expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
	});
});

describe("renderDiffHtml", () => {
	it("wraps changed lines in hljs spans with git-style prefixes", () => {
		const html = renderDiffHtml([
			{ type: "context", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "B" },
		]);
		expect(html).toBe(
			`  a\n<span class="hljs-deletion">- b</span>\n<span class="hljs-addition">+ B</span>`
		);
	});

	it("escapes HTML in line content", () => {
		const html = renderDiffHtml([{ type: "add", text: `<img src="x" & y>` }]);
		expect(html).toBe(`<span class="hljs-addition">+ &lt;img src="x" &amp; y&gt;</span>`);
	});
});
