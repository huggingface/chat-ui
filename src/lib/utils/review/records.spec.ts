import { describe, expect, it } from "vitest";
import type { ReviewSchema } from "$lib/types/MlReview";
import { compileRecordValidator } from "./records";

const schema: Pick<ReviewSchema, "idField" | "fields" | "questions"> = {
	idField: "id",
	fields: [
		{ name: "body", type: "text" },
		{ name: "meta", type: "json" },
		{ name: "turns", type: "chat" },
		{ name: "img", type: "image" },
		{ name: "voice", type: "audio" },
		{ name: "clip", type: "video" },
		{ name: "score", type: "number" },
	],
	questions: [
		{
			name: "kind",
			type: "label",
			required: true,
			options: [{ value: "bug" }, { value: "feature" }],
		},
	],
};

const validate = compileRecordValidator(schema);

describe("compileRecordValidator", () => {
	it("keeps typed values, stringifies ids and stores suggestions apart", () => {
		const result = validate([
			{
				id: 7,
				body: "crash",
				meta: { a: [1] },
				turns: [{ role: "user", content: "hi" }],
				img: "hf://datasets/o/r/a.png",
				score: 0.5,
				suggestions: { kind: { value: "bug", score: 0.7, rationale: "stack trace" } },
			},
			{ id: "b", body: null },
		]);
		expect(result).toEqual({
			ok: true,
			records: [
				{
					id: "7",
					values: {
						body: "crash",
						meta: { a: [1] },
						turns: [{ role: "user", content: "hi" }],
						img: "hf://datasets/o/r/a.png",
						score: 0.5,
					},
					suggestions: { kind: { value: "bug", score: 0.7, rationale: "stack trace" } },
				},
				{ id: "b", values: {} },
			],
		});
	});

	it("reports wrong types by 1-based record position", () => {
		const result = validate([
			{ id: "a", body: "ok" },
			{ id: "b", body: 3 },
			{ id: "c", turns: [{ role: "user" }], img: "http://x/y.png", score: "1" },
			{ id: "d", body: ["bug"] },
		]);
		expect(result).toEqual({
			ok: false,
			errors: [
				"record 2: body must be a string",
				"record 3: turns must be a list of {role, content} turns",
				"record 3: img must be an https:// or hf:// URL",
				"record 3: score must be a number",
				"record 4: body must be a string; declare the field as json to show a list or an object",
			],
		});
	});

	it("takes audio and video as https or hf urls", () => {
		expect(
			validate([
				{ id: "a", voice: "hf://datasets/o/r/a.wav", clip: "https://x.test/c.mp4" },
				{ id: "b", voice: "file:///a.wav" },
			])
		).toEqual({ ok: false, errors: ["record 2: voice must be an https:// or hf:// URL"] });
	});

	it("needs present, unique ids", () => {
		const result = validate([{ id: "a" }, { body: "x" }, { id: "a" }, { id: "  " }]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual([
			"record 2: id is missing; every record needs a string or number id",
			'record 3: id "a" repeats record 1',
			"record 4: id is missing; every record needs a string or number id",
		]);
	});

	it("refuses unknown keys except suggestions, and bad suggestions", () => {
		const result = validate([
			{ id: "a", extra: 1, suggestions: { kind: { value: "bug" } } },
			{ id: "b", suggestions: { kind: { value: "nope" } } },
			{ id: "c", suggestions: { other: { value: "bug" } } },
			{ id: "d", suggestions: { kind: { value: "bug", score: 2 } } },
		]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual([
			'record 1: unknown key "extra"; declare it as a field or drop it',
			'record 2: suggestions.kind.value "nope" is not an option (bug, feature)',
			"record 3: suggestions.other names no declared question",
			"record 4: suggestions.kind.score must be a number from 0 to 1",
		]);
	});

	it("stops at ten errors", () => {
		const result = validate(Array.from({ length: 30 }, (_, i) => ({ id: String(i), body: i })));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toHaveLength(10);
		expect(result.errors[9]).toBe("record 10: body must be a string");
	});
});
