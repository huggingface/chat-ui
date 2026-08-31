import { describe, it, expect } from "vitest";
import { normalizeAskUserQuestion, answerToToolResult, chosenBudgetUsd } from "./askUserQuestion";

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

describe("options that grant budget", () => {
	const budgetQuestion = (setBudgetUsd: unknown) =>
		question({
			options: [
				{ label: "Rescope to a subset", description: "Half the data, half the cost." },
				{ label: "Run it in full", description: "The whole dataset.", setBudgetUsd },
			],
		});

	it("keeps a sane amount on the option", () => {
		const payload = ok({ questions: [budgetQuestion(4.5)] });
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[1].setBudgetUsd).toBe(4.5);
		expect(field.options[0].setBudgetUsd).toBeUndefined();
	});

	it("drops garbage amounts and clamps absurd ones", () => {
		for (const bad of [-3, 0, NaN, Infinity, "10"]) {
			const payload = ok({ questions: [budgetQuestion(bad)] });
			const field = payload.fields?.[0];
			if (field?.kind !== "select") throw new Error("expected a select");
			expect(field.options[1].setBudgetUsd).toBeUndefined();
		}
		const payload = ok({ questions: [budgetQuestion(1_000_000)] });
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[1].setBudgetUsd).toBe(10_000);
	});

	it("reads the grant from the chosen option, never from typed text", () => {
		const payload = { ...ok({ questions: [budgetQuestion(4.5)] }), elicitationId: "x" };
		expect(chosenBudgetUsd(payload, { q1: "Run it in full" })).toBe(4.5);
		expect(chosenBudgetUsd(payload, { q1: "Rescope to a subset" })).toBeUndefined();
		// "Other" text that happens to name the option's label semantics grants nothing.
		expect(chosenBudgetUsd(payload, { q1: "run it in full please" })).toBeUndefined();
	});

	it("tells the model the budget it now has", () => {
		const payload = { ...ok({ questions: [budgetQuestion(4.5)] }), elicitationId: "x" };
		expect(answerToToolResult(payload, "accept", { q1: "Run it in full" })).toContain(
			"The session compute budget is now $4.50."
		);
		expect(answerToToolResult(payload, "accept", { q1: "Rescope to a subset" })).not.toContain(
			"budget is now"
		);
	});
});

describe("budget questions must carry real grants", () => {
	// The observed failure: dollar amounts in labels, no setBudgetUsd anywhere —
	// the user clicks "$1", nothing reaches the ledger.
	it("bounces a budget question whose options only wave dollar amounts", () => {
		const result = normalizeAskUserQuestion({
			questions: [
				question({
					question: "What compute budget should I reserve against?",
					options: [
						{ label: "$1 — enough for a tiny check", description: "Minimal." },
						{ label: "$5", description: "Room for retries." },
					],
				}),
			],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("setBudgetUsd");
	});

	it("passes once at least one option carries the grant", () => {
		const payload = ok({
			questions: [
				question({
					question: "What compute budget should I reserve against?",
					options: [
						{ label: "$1 — tiny check", description: "Minimal.", setBudgetUsd: 1 },
						{ label: "$0 — no raise", description: "Keep as is." },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[0].setBudgetUsd).toBe(1);
	});

	it("leaves non-budget questions alone however much they talk prices", () => {
		const payload = ok({
			questions: [
				question({
					question: "Which flavor should the run use?",
					options: [
						{ label: "t4-small ($0.40/hr)", description: "Cheapest GPU." },
						{ label: "a10g-large ($1.50/hr)", description: "Faster." },
					],
				}),
			],
		});
		expect(payload.fields).toHaveLength(1);
	});
});
