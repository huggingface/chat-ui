import { describe, it, expect } from "vitest";
import { normalizeAskUserQuestion, answerToToolResult } from "./askUserQuestion";

const question = (over: Record<string, unknown> = {}) => ({
	question: "Which database?",
	header: "Database",
	multiSelect: false,
	options: [
		{ label: "Postgres", description: "Relational." },
		{ label: "Mongo", description: "Document." },
	],
	...over,
});

const ok = (args: unknown) => {
	const result = normalizeAskUserQuestion(args);
	if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
	return result.payload;
};

describe("a question from the model", () => {
	it("becomes a select field the existing form can render", () => {
		const payload = ok({ questions: [question()] });
		expect(payload.source).toBe("assistant");
		expect(payload.fields).toEqual([
			{
				kind: "select",
				name: "q1",
				title: "Database",
				description: "Which database?",
				required: true,
				multiple: false,
				allowOther: true,
				options: [
					{ value: "Postgres", label: "Postgres", description: "Relational." },
					{ value: "Mongo", label: "Mongo", description: "Document." },
				],
			},
		]);
	});

	it("carries multiSelect through as a multi-pick that needs an answer", () => {
		const [field] = ok({ questions: [question({ multiSelect: true })] }).fields ?? [];
		expect(field).toMatchObject({ multiple: true, minItems: 1 });
	});

	it("drops options that repeat, since the form keys them by value", () => {
		const [field] =
			ok({
				questions: [
					question({
						options: [
							{ label: "Postgres", description: "One." },
							{ label: "Postgres", description: "Two." },
							{ label: "Mongo", description: "Three." },
						],
					}),
				],
			}).fields ?? [];
		expect(field).toMatchObject({
			options: [
				{ value: "Postgres", label: "Postgres" },
				{ value: "Mongo", label: "Mongo" },
			],
		});
	});

	it("strips control characters out of model-authored text", () => {
		const [field] =
			ok({
				questions: [question({ header: "Data\u0000base\u202E" })],
			}).fields ?? [];
		expect(field).toMatchObject({ title: "Database" });
	});
});

describe("a question that cannot be put to anyone", () => {
	const rejects = (args: unknown) =>
		expect(normalizeAskUserQuestion(args)).toMatchObject({ ok: false });

	it("is refused rather than rendered half-formed", () => {
		rejects({ questions: [] });
		rejects({ questions: [question({ options: [{ label: "Only one", description: "x" }] })] });
		rejects({ questions: [question({ question: "   " })] });
		rejects({ questions: Array.from({ length: 5 }, () => question()) });
	});
});

describe("the result handed back to the model", () => {
	const payload = { ...ok({ questions: [question()] }), elicitationId: "x" };

	it("names the question alongside the choice", () => {
		const text = answerToToolResult(payload, "accept", { q1: "Postgres" });
		expect(text).toContain("Which database?");
		expect(text).toContain("Postgres");
	});

	it("joins a multi-pick answer", () => {
		expect(answerToToolResult(payload, "accept", { q1: ["Postgres", "Mongo"] })).toContain(
			"Postgres, Mongo"
		);
	});

	it("tells the model to carry on when nobody answered", () => {
		expect(answerToToolResult(payload, "decline")).toMatch(/best judgement/);
		expect(answerToToolResult(payload, "cancel")).toMatch(/best judgement/);
	});
});
