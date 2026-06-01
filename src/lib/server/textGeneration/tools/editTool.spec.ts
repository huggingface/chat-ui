import { describe, it, expect } from "vitest";
import { applyEdits, renderCodeBlock, EditError } from "./editTool";

describe("applyEdits", () => {
	it("applies a single replacement", () => {
		expect(applyEdits("def foo():\n    return 1\n", [{ oldText: "foo", newText: "bar" }])).toEqual({
			content: "def bar():\n    return 1\n",
			replaced: 1,
		});
	});

	it("applies multiple non-overlapping edits regardless of order", () => {
		const res = applyEdits("a = 1\nb = 2\nc = 3\n", [
			{ oldText: "c = 3", newText: "c = 30" },
			{ oldText: "a = 1", newText: "a = 10" },
		]);
		expect(res.content).toBe("a = 10\nb = 2\nc = 30\n");
		expect(res.replaced).toBe(2);
	});

	it("throws when oldText is not found", () => {
		expect(() => applyEdits("hello", [{ oldText: "world", newText: "x" }])).toThrow(EditError);
	});

	it("throws when oldText is not unique", () => {
		expect(() => applyEdits("x x", [{ oldText: "x", newText: "y" }])).toThrow(/not unique/);
	});

	it("throws when there are no edits", () => {
		expect(() => applyEdits("x", [])).toThrow(EditError);
	});

	it("detects overlapping edits", () => {
		expect(() =>
			applyEdits("abcdef", [
				{ oldText: "abc", newText: "X" },
				{ oldText: "bcd", newText: "Y" },
			])
		).toThrow(/overlap/);
	});

	it("normalizes CRLF for matching and restores it", () => {
		const res = applyEdits("line1\r\nline2\r\n", [
			{ oldText: "line1\nline2", newText: "lineA\nlineB" },
		]);
		expect(res.content).toBe("lineA\r\nlineB\r\n");
	});
});

describe("renderCodeBlock", () => {
	it("renders language and path on the fence", () => {
		expect(renderCodeBlock({ path: "app.py", language: "python", content: "print(1)" })).toBe(
			"```python app.py\nprint(1)\n```"
		);
	});

	it("renders without a path when unlabeled", () => {
		expect(renderCodeBlock({ language: "js", content: "x" })).toBe("```js\nx\n```");
	});

	it("uses a longer fence when the content contains backticks", () => {
		const out = renderCodeBlock({ language: "markdown", content: "```\ncode\n```" });
		expect(out.startsWith("````markdown\n")).toBe(true);
		expect(out.endsWith("\n````")).toBe(true);
	});
});
