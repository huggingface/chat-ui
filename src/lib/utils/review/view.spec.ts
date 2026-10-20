import { describe, expect, it } from "vitest";
import type { ReviewSchema } from "$lib/types/MlReview";
import { draftStatus, findQuote, imageUrl, pick, quoteAt, suggestionVisible } from "./view";

const schema = (required: boolean): Pick<ReviewSchema, "questions"> => ({
	questions: [
		{ name: "kind", type: "label", required, options: [{ value: "a" }, { value: "b" }] },
		{ name: "note", type: "text", required: false, maxLength: 100 },
	],
});

describe("draftStatus", () => {
	it("is answered once every required question is", () => {
		expect(draftStatus(schema(true), { note: "x" }, undefined, { answering: true })).toBe(
			"pending"
		);
		expect(draftStatus(schema(true), { kind: "a" }, undefined, { answering: true })).toBe(
			"answered"
		);
	});

	it("is answered by any answer when nothing is required", () => {
		expect(draftStatus(schema(false), { note: " " }, undefined, { answering: true })).toBe(
			"pending"
		);
		expect(draftStatus(schema(false), { note: "x" }, undefined, { answering: true })).toBe(
			"answered"
		);
	});

	it("keeps a skip until the user answers again", () => {
		expect(draftStatus(schema(true), {}, "skipped", { answering: false })).toBe("skipped");
		expect(draftStatus(schema(true), { kind: "a" }, "skipped", { answering: true })).toBe(
			"answered"
		);
	});
});

describe("quotes", () => {
	const text = "the cat sat on the mat, the cat ran";

	it("finds a repeated quote by its context", () => {
		const second = text.lastIndexOf("the cat");
		const quote = quoteAt(text, second, second + "the cat".length);
		expect(quote.prefix).toBe(text.slice(0, second));
		expect(findQuote(text, quote)).toEqual({ start: second, end: second + 7 });
	});

	it("loses a quote the text no longer holds", () => {
		expect(findQuote(text, { exact: "the dog", prefix: "", suffix: "" })).toBeUndefined();
	});
});

it("toggles a multi label pick and replaces any other", () => {
	const multi = {
		name: "tags",
		type: "multi_label" as const,
		required: false,
		options: [{ value: "a" }, { value: "b" }],
	};
	expect(pick(multi, ["a"], "b")).toEqual(["a", "b"]);
	expect(pick(multi, ["a", "b"], "a")).toEqual(["b"]);
	expect(pick(schema(true).questions[0], "a", "b")).toBe("b");
});

it("shows an after_answer suggestion only once answered", () => {
	expect(suggestionVisible("after_answer", undefined)).toBe(false);
	expect(suggestionVisible("after_answer", "a")).toBe(true);
	expect(suggestionVisible("shown", undefined)).toBe(true);
	expect(suggestionVisible("none", "a")).toBe(false);
});

it("turns hf:// images into public resolve URLs", () => {
	expect(imageUrl("hf://datasets/org/set/img/1.png")).toBe(
		"https://huggingface.co/datasets/org/set/resolve/main/img/1.png"
	);
	expect(imageUrl("hf://org/model@v2/a.jpg")).toBe(
		"https://huggingface.co/org/model/resolve/v2/a.jpg"
	);
	expect(imageUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
	expect(imageUrl("hf://buckets/org")).toBeUndefined();
});
