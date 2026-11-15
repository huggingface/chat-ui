import { describe, expect, it } from "vitest";
import { cellValue, columnType, deriveFields, fieldNameFor } from "./features";

describe("dataset features as review fields", () => {
	it("maps the datasets library types", () => {
		expect(columnType({ _type: "Value", dtype: "string" })).toEqual({ type: "text" });
		expect(columnType({ _type: "Value", dtype: "int64" })).toEqual({ type: "number" });
		expect(columnType({ _type: "Value", dtype: "float32" })).toEqual({ type: "number" });
		expect(columnType({ _type: "Value", dtype: "bool" })).toEqual({ type: "category" });
		expect(columnType({ _type: "ClassLabel", names: ["neg", "pos"] })).toEqual({
			type: "category",
			names: ["neg", "pos"],
		});
		expect(columnType({ _type: "Image" })).toEqual({ type: "image" });
		expect(columnType({ _type: "Audio", sampling_rate: 16000 })).toEqual({ type: "audio" });
		expect(columnType({ _type: "Video" })).toEqual({ type: "video" });
		expect(columnType({ _type: "Sequence", feature: { _type: "Value", dtype: "int32" } })).toEqual({
			type: "json",
		});
		expect(columnType({ a: { _type: "Value", dtype: "string" } })).toEqual({ type: "json" });
		expect(columnType({ _type: "Value", dtype: "binary" })).toBeUndefined();
		expect(columnType({ _type: "Pdf" })).toBeUndefined();
	});

	it("shows a list of role and content turns as chat, in both list spellings", () => {
		const turn = {
			role: { _type: "Value", dtype: "string" },
			content: { _type: "Value", dtype: "string" },
		};
		expect(columnType([turn])).toEqual({ type: "chat" });
		expect(columnType({ _type: "List", feature: turn })).toEqual({ type: "chat" });
	});

	it("names fields in snake case, unique and never the reserved key", () => {
		const taken = new Set<string>();
		expect(fieldNameFor("Question Title", taken)).toBe("question_title");
		expect(fieldNameFor("question-title", taken)).toBe("question_title_2");
		expect(fieldNameFor("camelCase", taken)).toBe("camel_case");
		expect(fieldNameFor("2nd", taken)).toBe("f_2nd");
		expect(fieldNameFor("suggestions", taken)).toBe("suggestions_column");
		expect(fieldNameFor("日本語", taken)).toBe("f");
		expect(fieldNameFor("x".repeat(60), taken)).toHaveLength(40);
	});

	it("derives every showable column, keeping the source column when renamed", () => {
		const derived = deriveFields(
			[
				{ name: "id", feature: { _type: "Value", dtype: "int64" } },
				{ name: "Text", feature: { _type: "Value", dtype: "string" } },
				{ name: "label", feature: { _type: "ClassLabel", names: ["a", "b"] } },
				{ name: "blob", feature: { _type: "Value", dtype: "binary" } },
			],
			"id"
		);
		expect(derived.fields).toEqual([
			{ name: "text", type: "text", column: "Text" },
			{ name: "label", type: "category" },
		]);
		expect(derived.skipped).toEqual(["blob (unsupported type)"]);
	});

	it("shows a ClassLabel by its name and keeps a media url", () => {
		const kind = { type: "category" as const, names: ["neg", "pos"] };
		expect(cellValue("category", 1, kind)).toBe("pos");
		expect(cellValue("category", -1, kind)).toBeUndefined();
		expect(cellValue("number", BigInt(1))).toBe(1);
		expect(cellValue("text", 3)).toBe("3");
		expect(cellValue("json", { n: BigInt(2), raw: new Uint8Array(4) })).toEqual({
			n: 2,
			raw: "<4 bytes>",
		});
		expect(cellValue("image", "https://x/a.png")).toBe("https://x/a.png");
		expect(cellValue("text", null)).toBeUndefined();
	});
});
