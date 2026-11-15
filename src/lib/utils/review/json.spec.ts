import { describe, expect, it } from "vitest";
import { isFlatObject, parseJsonText, unpackJson } from "./json";

describe("parseJsonText", () => {
	it("parses an object or array and nothing else", () => {
		expect(parseJsonText('{"a": 1}')).toEqual({ a: 1 });
		expect(parseJsonText("  [1, 2]")).toEqual([1, 2]);
		expect(parseJsonText('"just a string"')).toBeUndefined();
		expect(parseJsonText("42")).toBeUndefined();
		expect(parseJsonText("{not json")).toBeUndefined();
		expect(parseJsonText("plain words")).toBeUndefined();
	});

	it("leaves a huge cell as text", () => {
		expect(parseJsonText(`[${"1,".repeat(60_000)}1]`)).toBeUndefined();
	});
});

describe("unpackJson", () => {
	it("opens a string holding JSON, and JSON nested in its strings", () => {
		const inner = JSON.stringify({ true: "At least one span.", false: "No span." });
		const outer = JSON.stringify({ criteria: inner, n: 2 });
		expect(unpackJson(outer)).toEqual({
			criteria: { true: "At least one span.", false: "No span." },
			n: 2,
		});
	});

	it("keeps strings that are not JSON and does not change the input", () => {
		const value = { a: "{nope", b: ["x"] };
		expect(unpackJson(value)).toEqual(value);
		expect(value).toEqual({ a: "{nope", b: ["x"] });
	});

	it("stops opening strings past the depth cap", () => {
		let value = JSON.stringify({ leaf: true });
		for (let i = 0; i < 10; i += 1) value = JSON.stringify({ next: value });
		const text = JSON.stringify(unpackJson(value));
		expect(text).toContain('\\"next\\"');
	});
});

describe("isFlatObject", () => {
	it("is true for a few short scalars only", () => {
		expect(isFlatObject({ true: "yes", false: "no" })).toBe(true);
		expect(isFlatObject({ a: { b: 1 } })).toBe(false);
		expect(isFlatObject({ a: "x".repeat(300) })).toBe(false);
		expect(isFlatObject([1, 2])).toBe(false);
		expect(isFlatObject({})).toBe(false);
	});
});
