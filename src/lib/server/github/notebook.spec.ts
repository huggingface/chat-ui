import { describe, expect, it } from "vitest";
import { notebookToMarkdown } from "./notebook";

const notebook = (cells: unknown[], metadata: Record<string, unknown> = {}) =>
	JSON.stringify({ nbformat: 4, metadata, cells });

describe("notebookToMarkdown", () => {
	it("passes markdown cells through and fences code cells", () => {
		const rendered = notebookToMarkdown(
			notebook([
				{ cell_type: "markdown", source: ["# Title\n", "\n", "Prose.\n"] },
				{ cell_type: "code", source: "import trl\n" },
			])
		);

		expect(rendered).toBe("# Title\n\nProse.\n\n```python\nimport trl\n```");
	});

	it("strips outputs", () => {
		// They are most of a notebook's bytes and none of its value for grounding: a
		// tensor repr or a base64 PNG tells you nothing about the current API.
		const rendered = notebookToMarkdown(
			notebook([
				{
					cell_type: "code",
					source: "model.generate()\n",
					execution_count: 3,
					outputs: [
						{ output_type: "stream", text: ["noise".repeat(500)] },
						{ output_type: "display_data", data: { "image/png": "iVBORw0KGgo=" } },
					],
				},
			])
		);

		expect(rendered).toContain("model.generate()");
		expect(rendered).not.toContain("noise");
		expect(rendered).not.toContain("iVBORw0KGgo");
	});

	it("drops cells the author marked as scaffolding", () => {
		const rendered = notebookToMarkdown(
			notebook([
				{ cell_type: "code", metadata: { tags: ["hide"] }, source: "!pip install trl\n" },
				{ cell_type: "code", metadata: { tags: ["Hidden"] }, source: "import os\n" },
				{ cell_type: "code", metadata: { tags: ["remove"] }, source: "cleanup()\n" },
				{ cell_type: "code", metadata: { tags: ["keep"] }, source: "train()\n" },
			])
		);

		expect(rendered).toBe("```python\ntrain()\n```");
	});

	it("joins a list-valued source, as nbformat allows", () => {
		const rendered = notebookToMarkdown(
			notebook([{ cell_type: "code", source: ["a = 1\n", "b = 2\n"] }])
		);
		expect(rendered).toContain("a = 1\nb = 2");
	});

	it("takes the language from the notebook's own metadata", () => {
		const rendered = notebookToMarkdown(
			notebook([{ cell_type: "code", source: "println!()\n" }], {
				kernelspec: { language: "Rust" },
			})
		);
		expect(rendered).toContain("```rust");
	});

	it("uses a fence long enough to contain a cell that has its own", () => {
		const rendered = notebookToMarkdown(
			notebook([{ cell_type: "code", source: 'print("""\n```\n""")\n' }])
		);
		expect(rendered?.startsWith("````python")).toBe(true);
	});

	it("skips empty cells", () => {
		const rendered = notebookToMarkdown(
			notebook([
				{ cell_type: "code", source: "" },
				{ cell_type: "markdown", source: ["   \n"] },
				{ cell_type: "code", source: "x = 1" },
			])
		);
		expect(rendered).toBe("```python\nx = 1\n```");
	});

	it("returns null for anything it cannot render, so the caller keeps the raw text", () => {
		expect(notebookToMarkdown("{ not json")).toBeNull();
		expect(notebookToMarkdown("[]")).toBeNull();
		expect(notebookToMarkdown(JSON.stringify({ nbformat: 4 }))).toBeNull();
		expect(notebookToMarkdown('"a string"')).toBeNull();
	});

	it("ignores a cell that is not an object rather than failing the whole notebook", () => {
		const rendered = notebookToMarkdown(
			notebook([null, "nonsense", { cell_type: "code", source: "ok()\n" }])
		);
		expect(rendered).toBe("```python\nok()\n```");
	});
});
