import { describe, expect, it } from "vitest";
import { applyFileEdits, summarizeChanges } from "./edits";

describe("applyFileEdits", () => {
	it("replaces the first occurrence only, in order", () => {
		const result = applyFileEdits("lr = 1e-4\nlr = 1e-4\n", [
			{ old: "lr = 1e-4", new: "lr = 1e-5" },
		]);
		expect(result).toEqual({ ok: true, content: "lr = 1e-5\nlr = 1e-4\n" });
	});

	it("applies later pairs to the output of earlier ones", () => {
		const result = applyFileEdits("v1", [
			{ old: "v1", new: "v2" },
			{ old: "v2", new: "v3" },
		]);
		expect(result).toEqual({ ok: true, content: "v3" });
	});

	it("tolerates miscounted indentation and swapped typography in old", () => {
		const content = 'def f():\n        x = "a"\n        return x\n';
		const result = applyFileEdits(content, [
			{ old: "x = “a”\n    return x", new: 'x = "b"\n        return x' },
		]);
		expect(result).toEqual({ ok: true, content: 'def f():\n        x = "b"\n        return x\n' });
	});

	it("is all or nothing, and says which pair failed", () => {
		const result = applyFileEdits("alpha beta", [
			{ old: "alpha", new: "ALPHA" },
			{ old: "gamma", new: "GAMMA" },
			{ old: "beta", new: "BETA" },
		]);
		expect(result).toEqual({ ok: false, index: 1, reason: "no_match" });
	});

	it("refuses an empty old rather than inserting at the start", () => {
		expect(applyFileEdits("abc", [{ old: "", new: "x" }])).toEqual({
			ok: false,
			index: 0,
			reason: "empty",
		});
	});
});

describe("summarizeChanges", () => {
	it("prints each changed hunk with the line numbers read_file shows", () => {
		const before = ["a", "b", "c", "d", "e", "f"].join("\n");
		const after = ["a", "B", "c", "d", "e", "f", "g"].join("\n");
		const summary = summarizeChanges(before, after);

		expect(summary).toBe(["@@ -2,1 +2,1 @@", "-b", "+B", "@@ -7,0 +7,1 @@", "+g"].join("\n"));
	});

	it("is empty when nothing changed", () => {
		expect(summarizeChanges("same\n", "same\n")).toBe("");
	});

	it("caps a large diff and says so", () => {
		const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
		const after = Array.from({ length: 400 }, (_, i) => `LINE ${i}`).join("\n");
		const summary = summarizeChanges(before, after);

		expect(summary.length).toBeLessThan(2_200);
		expect(summary).toContain("further hunks omitted");
	});
});
