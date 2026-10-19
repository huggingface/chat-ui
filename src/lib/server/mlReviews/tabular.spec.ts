import { describe, expect, it } from "vitest";
import type { ReviewSchema } from "$lib/types/MlReview";
import { parseDelimited, recordsFromTabular, tabularFormat } from "./tabular";

describe("tabularFormat", () => {
	it("goes by the extension alone", () => {
		expect(tabularFormat("triage/batch.csv")).toBe("csv");
		expect(tabularFormat("/work/sample.TSV")).toBe("tsv");
		expect(tabularFormat("hf://datasets/o/r/rows.csv")).toBe("csv");
		expect(tabularFormat("rows.jsonl")).toBeUndefined();
		expect(tabularFormat("rows.csv.jsonl")).toBeUndefined();
	});
});

const BOM = String.fromCharCode(0xfeff);

describe("parseDelimited", () => {
	it("reads rfc 4180 quoting: delimiters, doubled quotes and newlines inside quotes", () => {
		const csv =
			BOM +
			"id,title,body\r\n" +
			'gh-1,"Crash, on start","Steps:\r\n1. open\n2. click ""Run""\n"\r\n' +
			"gh-2,Dark mode,plain\n";
		expect(parseDelimited(csv, "csv", "a.csv")).toEqual({
			columns: ["id", "title", "body"],
			rows: [
				{ id: "gh-1", title: "Crash, on start", body: 'Steps:\r\n1. open\n2. click "Run"\n' },
				{ id: "gh-2", title: "Dark mode", body: "plain" },
			],
		});
	});

	it("reads tsv with commas and quotes left as text", () => {
		const tsv = 'id\ttext\nr1\tsays "hi", then leaves\nr2\t"tabbed\tcell"\n';
		expect(parseDelimited(tsv, "tsv", "a.tsv")).toEqual({
			columns: ["id", "text"],
			rows: [
				{ id: "r1", text: 'says "hi", then leaves' },
				{ id: "r2", text: "tabbed\tcell" },
			],
		});
	});

	it("leaves an empty cell out, like a sparse json row, and skips blank lines", () => {
		expect(parseDelimited("id,score,note\na,,\n\nb,2,x", "csv", "a.csv")).toEqual({
			columns: ["id", "score", "note"],
			rows: [{ id: "a" }, { id: "b", score: "2", note: "x" }],
		});
	});

	it("names the line of a row that does not match the header", () => {
		expect(parseDelimited('id,body\na,"two\nlines"\nb,x,y\n', "csv", "a.csv")).toEqual({
			error: "a.csv line 4 has 3 cells, the header has 2",
		});
	});

	it("refuses an unclosed quote and a header it cannot map", () => {
		expect(parseDelimited('id,body\na,"never closed\n', "csv", "a.csv")).toEqual({
			error: "a.csv has a quoted cell opened on line 2 that never closes",
		});
		expect(parseDelimited("id,,body\n", "csv", "a.csv")).toEqual({
			error: "a.csv header column 2 has no name",
		});
		expect(parseDelimited("id,body,body\n", "csv", "a.csv")).toEqual({
			error: 'a.csv header names "body" twice',
		});
		expect(parseDelimited("", "csv", "a.csv")).toEqual({ error: "a.csv is empty" });
	});
});

describe("recordsFromTabular", () => {
	const schema: Pick<ReviewSchema, "idField" | "fields"> = {
		idField: "id",
		fields: [
			{ name: "body", type: "text" },
			{ name: "score", type: "number" },
			{ name: "meta", type: "json" },
		],
	};

	it("converts cells to the declared types", () => {
		expect(
			recordsFromTabular(
				schema,
				{
					columns: ["id", "body", "score", "meta", "suggestions"],
					rows: [
						{
							id: "7",
							body: "42",
							score: " 0.5 ",
							meta: '{"tags":["a"]}',
							suggestions: '{"kind":{"value":"bug"}}',
						},
						{ id: "8", score: "high", meta: "not json" },
					],
				},
				"a.csv"
			)
		).toEqual({
			records: [
				{
					id: "7",
					body: "42",
					score: 0.5,
					meta: { tags: ["a"] },
					suggestions: { kind: { value: "bug" } },
				},
				{ id: "8", score: "high", meta: "not json" },
			],
		});
	});

	it("refuses a header that does not match the declared fields, naming both", () => {
		expect(
			recordsFromTabular(schema, { columns: ["id", "body", "label", "extra"], rows: [] }, "a.csv")
		).toEqual({
			error:
				'a.csv header columns "label", "extra" match no declared field (fields: body, score, meta); declare them or drop the column',
		});
		expect(recordsFromTabular(schema, { columns: ["key", "body"], rows: [] }, "a.csv")).toEqual({
			error: 'a.csv has no "id" column for id_field; its header is key, body',
		});
	});
});
