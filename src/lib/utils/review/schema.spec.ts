import { describe, expect, it } from "vitest";
import { parseReviewSchema, REVIEW_LIMITS } from "./schema";

const base = {
	title: "Issue triage, batch 1",
	fields: [
		{ name: "title", type: "text" },
		{ name: "body", type: "markdown" },
	],
};

const options = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `o${i}` }));

const error = (input: unknown) => {
	const parsed = parseReviewSchema(input);
	if (parsed.ok) throw new Error("expected a refusal");
	return parsed.error;
};

describe("parseReviewSchema", () => {
	it("normalises a declaration and fills the defaults", () => {
		const parsed = parseReviewSchema({
			...base,
			questions: [
				{ name: "kind", type: "label", required: true, options: options(3) },
				{ name: "severity", type: "rating" },
				{ name: "note", type: "text", target: "body" },
			],
		});
		expect(parsed).toEqual({
			ok: true,
			schema: {
				title: "Issue triage, batch 1",
				idField: "id",
				fields: base.fields,
				questions: [
					{ name: "kind", type: "label", required: true, options: options(3) },
					{ name: "severity", type: "rating", required: false, min: 1, max: 5 },
					{ name: "note", type: "text", required: false, target: "body", maxLength: 4_000 },
				],
				suggestions: "shown",
			},
		});
	});

	it("holds every limit, naming the path to fix", () => {
		const field = (i: number) => ({ name: `f${i}`, type: "text" });
		expect(
			error({
				...base,
				fields: Array.from({ length: REVIEW_LIMITS.fields + 1 }, (_, i) => field(i)),
			})
		).toBe("fields: at most 30 fields");
		expect(
			error({
				...base,
				questions: Array.from({ length: REVIEW_LIMITS.questions + 1 }, (_, i) => ({
					name: `q${i}`,
					type: "boolean",
				})),
			})
		).toBe("questions: at most 20 questions");
		expect(
			error({ ...base, questions: [{ name: "kind", type: "label", options: options(1) }] })
		).toBe("questions[0].options: give 2 to 20 options");
		expect(
			error({ ...base, questions: [{ name: "kind", type: "label", options: options(21) }] })
		).toBe("questions[0].options: give 2 to 20 options");
		expect(
			error({ ...base, questions: [{ name: "r", type: "rating", min: 0, max: 11 }] })
		).toContain("at most 11 steps");
		expect(
			parseReviewSchema({ ...base, questions: [{ name: "r", type: "rating", min: 0, max: 10 }] }).ok
		).toBe(true);
		expect(
			error({ ...base, questions: [{ name: "t", type: "text", max_length: 4_001 }] })
		).toContain("questions[0].max_length");
		expect(error({ ...base, fields: [{ name: "Body", type: "text" }] })).toContain(
			"lowercase snake_case"
		);
		expect(error({ ...base, fields: [{ name: "a".repeat(41), type: "text" }] })).toContain(
			"lowercase snake_case"
		);
	});

	it("refuses a target that names no field, and names the fields there are", () => {
		expect(error({ ...base, questions: [{ name: "fix", type: "text", target: "bdy" }] })).toBe(
			'questions[0].target: "bdy" is not a declared field (fields: title, body)'
		);
	});

	it("refuses repeated names and options, and the reserved suggestions key", () => {
		expect(error({ ...base, fields: [...base.fields, { name: "title", type: "json" }] })).toContain(
			'"title" is declared twice'
		);
		expect(
			error({
				...base,
				questions: [{ name: "k", type: "label", options: [{ value: "a" }, { value: "a" }] }],
			})
		).toContain('"a" is listed twice');
		expect(error({ ...base, fields: [{ name: "suggestions", type: "json" }] })).toContain(
			"reserved"
		);
	});

	it("checks multi_label pick counts against the options", () => {
		expect(
			error({
				...base,
				questions: [{ name: "a", type: "multi_label", options: options(3), max: 4 }],
			})
		).toContain("max: must be between 1 and 3");
		expect(
			error({
				...base,
				questions: [{ name: "a", type: "multi_label", options: options(3), min: 3, max: 2 }],
			})
		).toContain("min: must not exceed max");
	});

	it("refuses an unknown question type", () => {
		expect(error({ ...base, questions: [{ name: "a", type: "span" }] })).toContain(
			"questions[0].type"
		);
	});
});
