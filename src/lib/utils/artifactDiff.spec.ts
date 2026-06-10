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
	it("tints changed lines and keeps context plain", () => {
		const html = renderDiffHtml([
			{ type: "context", text: "a" },
			{ type: "del", text: "b" },
			{ type: "add", text: "B" },
		]);
		const lines = html.split("\n");
		expect(lines[0]).toBe("  a");
		expect(lines[1]).toBe(
			`<span class="diff-line diff-del"><span class="diff-sign">- </span>b</span>`
		);
		expect(lines[2]).toBe(
			`<span class="diff-line diff-add"><span class="diff-sign">+ </span>B</span>`
		);
	});

	it("escapes HTML in line content", () => {
		const html = renderDiffHtml([{ type: "add", text: `<img & y>` }]);
		expect(html).toContain("&lt;img &amp; y&gt;");
		expect(html).not.toContain("<img");
	});

	it("keeps syntax highlighting spans that cross line boundaries", () => {
		// Fake highlighter wrapping the whole document in one token span
		const highlight = (text: string) => `<span class="hljs-string">${text}</span>`;
		const html = renderDiffHtml(
			[
				{ type: "context", text: "a" },
				{ type: "add", text: "b" },
			],
			highlight
		);
		const lines = html.split("\n");
		// The span is closed and reopened so each rendered line is self-contained
		expect(lines[0]).toBe(`  <span class="hljs-string">a</span>`);
		expect(lines[1]).toBe(
			`<span class="diff-line diff-add"><span class="diff-sign">+ </span>` +
				`<span class="hljs-string">b</span></span>`
		);
	});

	it("emphasizes only the changed segment of a replaced line", () => {
		const html = renderDiffHtml(
			diffLines(`const el = create('div');`, `const el = create('span');`)
		);
		const lines = html.split("\n");
		expect(lines[0]).toContain(`<span class="diff-emph">div</span>`);
		expect(lines[1]).toContain(`<span class="diff-emph">span</span>`);
	});

	it("counts entities as single characters when emphasizing", () => {
		// The "<" before the change escapes to &lt; (one source character)
		const html = renderDiffHtml(diffLines(`if (a < b) return x;`, `if (a < b) return y;`));
		const lines = html.split("\n");
		expect(lines[0]).toContain(`&lt;`);
		expect(lines[0]).toContain(`<span class="diff-emph">x</span>`);
		expect(lines[1]).toContain(`<span class="diff-emph">y</span>`);
	});

	it("splits the emphasis chip around token tags instead of crossing them", () => {
		const highlight = (text: string) => text.replace(/\+/g, `<span class="hljs-operator">+</span>`);
		const html = renderDiffHtml(diffLines(`foo = bar1 + x;`, `foo = bar2 + y;`), highlight);
		const addLine = html.split("\n")[1];
		// The changed segment crosses the operator token: the chip closes before
		// the tag and reopens inside it, so nesting stays valid
		expect(addLine).toContain(`<span class="diff-emph">2 </span>`);
		expect(addLine).toContain(
			`<span class="hljs-operator"><span class="diff-emph">+</span></span>`
		);
		expect(addLine).toContain(`<span class="diff-emph"> y</span>`);
	});

	it("skips emphasis when the paired lines share almost nothing", () => {
		const html = renderDiffHtml([
			{ type: "del", text: "aaaaaaaaaa" },
			{ type: "add", text: "zzzzzzzzzz" },
		]);
		expect(html).not.toContain("diff-emph");
		expect(html).toContain("diff-del");
		expect(html).toContain("diff-add");
	});
});
