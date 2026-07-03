import { describe, expect, it } from "vitest";
import { isTrustedHighlighterHtml } from "./markedLight";

describe("isTrustedHighlighterHtml", () => {
	it("accepts plain escaped text with no tags", () => {
		expect(isTrustedHighlighterHtml("const x = 1;")).toBe(true);
		expect(isTrustedHighlighterHtml("if (a &lt; b &amp;&amp; c) {}")).toBe(true);
	});

	it("accepts hljs-style spans with a lone class attribute", () => {
		expect(
			isTrustedHighlighterHtml('<span class="hljs-keyword">const</span> x = <span>1</span>;')
		).toBe(true);
		expect(
			isTrustedHighlighterHtml(
				'<span class="hljs-title function_">fn</span>(<span class="hljs-params"></span>)'
			)
		).toBe(true);
	});

	it("accepts nested spans", () => {
		expect(
			isTrustedHighlighterHtml(
				'<span class="hljs-string">"a<span class="hljs-subst">b</span>"</span>'
			)
		).toBe(true);
	});

	it("rejects spans carrying any attribute other than a double-quoted class", () => {
		expect(isTrustedHighlighterHtml('<span onclick="x()">a</span>')).toBe(false);
		expect(isTrustedHighlighterHtml('<span class="x" onclick="y()">a</span>')).toBe(false);
		expect(isTrustedHighlighterHtml("<span class='x'>a</span>")).toBe(false);
		expect(isTrustedHighlighterHtml('<span data-x="1">a</span>')).toBe(false);
		expect(isTrustedHighlighterHtml('<span class="x"  >a</span>')).toBe(false);
	});

	it("rejects any non-span markup", () => {
		expect(isTrustedHighlighterHtml("<script>alert(1)</script>")).toBe(false);
		expect(isTrustedHighlighterHtml('<img src="x" onerror="y()">')).toBe(false);
		expect(isTrustedHighlighterHtml("<style>*{}</style>")).toBe(false);
		expect(isTrustedHighlighterHtml("a < b")).toBe(false);
	});

	it("rejects malformed closing spans", () => {
		expect(isTrustedHighlighterHtml("</span >")).toBe(false);
		expect(isTrustedHighlighterHtml('</span onclick="x">')).toBe(false);
	});
});
