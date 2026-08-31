import { describe, expect, it } from "vitest";
import { tableDataToCSV, tableDataToMarkdown, tableDataToTSV } from "./tableData";

describe("tableDataToCSV", () => {
	it("emits the header row followed by the body rows", () => {
		expect(
			tableDataToCSV({
				headers: ["Model", "Params"],
				rows: [
					["Qwen", "32B"],
					["Llama", "70B"],
				],
			})
		).toBe("Model,Params\nQwen,32B\nLlama,70B");
	});

	it("quotes cells containing a separator, quote or newline", () => {
		expect(
			tableDataToCSV({
				headers: ["a", "b", "c"],
				rows: [["x,y", 'say "hi"', "line\nbreak"]],
			})
		).toBe('a,b,c\n"x,y","say ""hi""","line\nbreak"');
	});

	it("omits the header row when there are no headers", () => {
		expect(tableDataToCSV({ headers: [], rows: [["a"]] })).toBe("a");
	});
});

describe("tableDataToTSV", () => {
	it("escapes tabs and newlines instead of quoting", () => {
		expect(tableDataToTSV({ headers: ["a", "b"], rows: [["with\ttab", "with\nnewline"]] })).toBe(
			"a\tb\nwith\\ttab\twith\\nnewline"
		);
	});
});

describe("tableDataToMarkdown", () => {
	it("round-trips a simple table", () => {
		expect(
			tableDataToMarkdown({
				headers: ["Model", "Params"],
				rows: [["Qwen", "32B"]],
			})
		).toBe("| Model | Params |\n| --- | --- |\n| Qwen | 32B |");
	});

	it("escapes backslashes and pipes, and turns newlines into <br>", () => {
		expect(tableDataToMarkdown({ headers: ["a"], rows: [["a|b"], ["c\\d"], ["e\nf"]] })).toBe(
			"| a |\n| --- |\n| a\\|b |\n| c\\\\d |\n| e<br>f |"
		);
	});

	it("pads short rows to the header's column count", () => {
		expect(tableDataToMarkdown({ headers: ["a", "b", "c"], rows: [["1"]] })).toBe(
			"| a | b | c |\n| --- | --- | --- |\n| 1 |  |  |"
		);
	});

	it("returns an empty string without headers, since the syntax requires them", () => {
		expect(tableDataToMarkdown({ headers: [], rows: [["a"]] })).toBe("");
	});
});
