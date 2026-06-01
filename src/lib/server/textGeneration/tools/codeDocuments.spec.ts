import { describe, it, expect } from "vitest";
import { extractCodeBlocks, CodeDocState } from "./codeDocuments";

describe("extractCodeBlocks", () => {
	it("extracts a labeled block", () => {
		const md = "intro\n```python app.py\nprint(1)\n```\noutro\n";
		expect(extractCodeBlocks(md)).toEqual([
			{ path: "app.py", language: "python", content: "print(1)" },
		]);
	});

	it("extracts an unlabeled block", () => {
		expect(extractCodeBlocks("```\nplain\n```")).toEqual([
			{ path: undefined, language: "", content: "plain" },
		]);
	});

	it("handles nested fences via a longer outer fence", () => {
		const md = "````md doc.md\n```\ninner\n```\n````";
		expect(extractCodeBlocks(md)).toEqual([
			{ path: "doc.md", language: "md", content: "```\ninner\n```" },
		]);
	});

	it("extracts multiple blocks", () => {
		const md = "```js a.js\nA\n```\ntext\n```css b.css\nB\n```";
		const blocks = extractCodeBlocks(md);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toEqual({ path: "a.js", language: "js", content: "A" });
		expect(blocks[1]).toEqual({ path: "b.css", language: "css", content: "B" });
	});
});

describe("CodeDocState", () => {
	it("tracks the latest content per path across assistant messages", () => {
		const state = CodeDocState.fromMessages([
			{ from: "user", content: "write it" },
			{ from: "assistant", content: "```python app.py\nprint(1)\n```" },
			{ from: "user", content: "change it" },
			{ from: "assistant", content: "```python app.py\nprint(2)\n```" },
		]);
		expect(state.lookup("app.py")?.content).toBe("print(2)");
	});

	it("matches by basename when the path differs", () => {
		const state = CodeDocState.fromMessages([
			{ from: "assistant", content: "```python src/app.py\nx = 1\n```" },
		]);
		expect(state.lookup("app.py")?.content).toBe("x = 1");
	});

	it("falls back to the most recent block when no path is given", () => {
		const state = CodeDocState.fromMessages([
			{ from: "assistant", content: "```js\nconsole.log(1)\n```" },
		]);
		expect(state.lookup()?.content).toBe("console.log(1)");
	});

	it("ignores code blocks from non-assistant messages", () => {
		const state = CodeDocState.fromMessages([
			{ from: "user", content: "```python app.py\nuser code\n```" },
		]);
		expect(state.hasAny()).toBe(false);
	});

	it("returns undefined for an unknown path", () => {
		const state = CodeDocState.fromMessages([
			{ from: "assistant", content: "```python app.py\nx = 1\n```" },
		]);
		expect(state.lookup("other.py")).toBeUndefined();
	});
});
