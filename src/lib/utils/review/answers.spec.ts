import { describe, expect, it } from "vitest";
import type { ReviewDraft, ReviewQuestion } from "$lib/types/MlReview";
import { blockers, validateAnswer } from "./answers";

const label: ReviewQuestion = {
	name: "kind",
	type: "label",
	required: true,
	options: [{ value: "bug" }, { value: "feature" }],
};
const multi: ReviewQuestion = {
	name: "areas",
	type: "multi_label",
	required: false,
	options: [{ value: "ui" }, { value: "api" }, { value: "docs" }],
	min: 1,
	max: 2,
};
const rating: ReviewQuestion = { name: "sev", type: "rating", required: false, min: 1, max: 5 };
const yesNo: ReviewQuestion = { name: "dup", type: "boolean", required: false };
const text: ReviewQuestion = { name: "note", type: "text", required: false, maxLength: 5 };

const draft = (answers: ReviewDraft["answers"], status: ReviewDraft["status"] = "answered") => ({
	status,
	answers,
	comments: [],
	updatedAt: new Date(),
});

describe("validateAnswer", () => {
	it("checks each question type", () => {
		expect(validateAnswer(label, "bug")).toBeUndefined();
		expect(validateAnswer(label, "nope")).toBe('"nope" is not an option (bug, feature)');
		expect(validateAnswer(label, ["bug"])).toBe("must be one option value");

		expect(validateAnswer(multi, ["ui", "api"])).toBeUndefined();
		expect(validateAnswer(multi, ["ui", "api", "docs"])).toBe("pick at most 2");
		expect(validateAnswer(multi, [])).toBe("pick at least 1");
		expect(validateAnswer(multi, ["ui", "ui"])).toBe("lists an option twice");
		expect(validateAnswer(multi, "ui")).toBe("must be a list of option values");

		expect(validateAnswer(rating, 3)).toBeUndefined();
		expect(validateAnswer(rating, 6)).toBe("must be between 1 and 5");
		expect(validateAnswer(rating, 2.5)).toBe("must be a whole number");

		expect(validateAnswer(yesNo, false)).toBeUndefined();
		expect(validateAnswer(yesNo, "yes")).toBe("must be true or false");

		expect(validateAnswer(text, "short")).toBeUndefined();
		expect(validateAnswer(text, "too long")).toBe("is 8 characters, over 5");
	});
});

describe("blockers", () => {
	const schema = { questions: [label, rating] };

	it("blocks a missing required answer on every record not skipped or discarded", () => {
		expect(
			blockers(
				schema,
				{
					"0": draft({ kind: "bug" }),
					"1": draft({}, "skipped"),
					"2": draft({}, "discarded"),
					"3": draft({ kind: "" }),
				},
				5
			)
		).toEqual([
			{ record: 3, question: "kind", reason: "required" },
			{ record: 4, question: "kind", reason: "required" },
		]);
	});

	it("blocks an invalid answer even where nothing is required, skipped or not", () => {
		expect(
			blockers(
				schema,
				{ "0": draft({ kind: "bug", sev: 9 }), "1": draft({ sev: 0 }, "skipped") },
				2
			)
		).toEqual([
			{ record: 0, question: "sev", reason: "must be between 1 and 5" },
			{ record: 1, question: "sev", reason: "must be between 1 and 5" },
		]);
	});

	it("lets a review with no required question through untouched", () => {
		expect(blockers({ questions: [rating] }, {}, 50)).toEqual([]);
	});
});
