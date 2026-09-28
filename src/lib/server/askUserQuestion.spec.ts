import { describe, it, expect } from "vitest";
import { MAX_OTHER_CHARS } from "$lib/types/McpElicitation";
import { normalizeAskUserQuestion, answerToToolResult, chosenBudgetUsd } from "./askUserQuestion";
import { validateElicitationContent } from "./mcp/elicitationSchema";

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

describe("long model-authored text", () => {
	// The 2026-09 panel repro: 185 characters of question, descriptions well past the old 200.
	const longQuestion =
		"Before I start the fine-tuning run, which evaluation should I use to decide whether the " +
		"new checkpoint is actually better than the base model on your support-ticket data?";
	const longDescription =
		"Hold out 10% of the labelled tickets and report accuracy and macro-F1 per category, " +
		"which is quick and cheap but only tells you about categories you already have enough " +
		"examples of, so rare categories will look noisy and the comparison may flatter the base.";

	it("reaches the panel whole, with nothing cut or marked as cut", () => {
		const header = "Evaluation method";
		const label = "Held-out split of the labelled support tickets";
		const payload = ok({
			questions: [
				question({
					question: longQuestion,
					header,
					options: [
						{ label, description: longDescription },
						{ label: "LLM judge", description: "d".repeat(4_000) },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");

		expect(field.description).toBe(longQuestion);
		expect(field.title).toBe(header);
		expect(field.options[0]).toMatchObject({ label, value: label, description: longDescription });
		expect(field.options[1].description).toHaveLength(4_000);
		expect(JSON.stringify(payload)).not.toContain("…");
	});

	const refusal = (args: unknown) => {
		const result = normalizeAskUserQuestion(args);
		if (result.ok) throw new Error("expected a refusal");
		return result.reason;
	};

	it("is refused past the ceiling, saying where and how to fix it", () => {
		expect(refusal({ questions: [question({ question: "q".repeat(4_001) })] })).toBe(
			"question 1 is 4001 characters, over the 4000 limit — ask it in a sentence or two"
		);
		expect(refusal({ questions: [question(), question({ header: "h".repeat(501) })] })).toBe(
			"question 2's header is 501 characters, over the 500 limit — name the decision in a word or two"
		);
		expect(
			refusal({
				questions: [
					question({
						options: [
							{ label: "Postgres", description: "Relational." },
							{ label: "l".repeat(501), description: "Document." },
						],
					}),
				],
			})
		).toBe(
			"question 1 option 2's label is 501 characters, over the 500 limit — keep the label to a few words and move the detail into its description"
		);
		expect(
			refusal({
				questions: [
					question({
						options: [
							{ label: "Postgres", description: "d".repeat(4_001) },
							{ label: "Mongo", description: "Document." },
						],
					}),
				],
			})
		).toBe(
			"question 1 option 1's description is 4001 characters, over the 4000 limit — say what picking it means in a sentence or two"
		);
	});

	it("measures what is shown, so stripped control characters do not count", () => {
		const padded = `${"​".repeat(600)}Postgres`;
		const payload = ok({
			questions: [
				question({
					options: [
						{ label: padded, description: "Relational." },
						{ label: "Mongo", description: "Document." },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[0].label).toBe("Postgres");
	});

	it("leaves every allowed answer small enough to send", () => {
		// Labels are the answer's values: four multi-picks of the longest labels, each with a
		// typed answer, must still clear the answer ceiling.
		const labels = (q: number) => Array.from({ length: 4 }, (_, i) => `${q}${i}`.padEnd(500, "x"));
		const payload = ok({
			questions: Array.from({ length: 4 }, (_, q) =>
				question({
					multiSelect: true,
					options: labels(q).map((label) => ({ label, description: "d" })),
				})
			),
		});
		const content = Object.fromEntries(
			(payload.fields ?? []).map((field, q) => [
				field.name,
				[...labels(q), "o".repeat(MAX_OTHER_CHARS)],
			])
		);

		expect(validateElicitationContent(payload.fields ?? [], content)).toMatchObject({ ok: true });
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

	it("keeps a sane amount on the option and generates its title from it", () => {
		const payload = ok({ questions: [budgetQuestion(4.5)] });
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[1].setBudgetUsd).toBe(4.5);
		// The model's label is ignored outright — the title is the amount, so no
		// authored text can contradict what a click applies.
		expect(field.options[1].label).toBe("Set budget to $4.50");
		expect(field.options[1].description).toBe("The whole dataset.");
		expect(field.options[0].setBudgetUsd).toBeUndefined();
		expect(field.options[0].label).toBe("Rescope to a subset");
	});

	it("drops the model's label entirely, even as a description fallback", () => {
		const payload = ok({
			questions: [
				question({
					options: [
						{ label: "Rescope", description: "Half the data." },
						{ label: "Set the budget to $1", setBudgetUsd: 1000 },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options[1].label).toBe("Set budget to $1000.00");
		expect(field.options[1].description).toBeUndefined();
	});

	it("collapses two grants of the same amount into one option", () => {
		const payload = ok({
			questions: [
				question({
					options: [
						{ label: "Cheap", description: "A.", setBudgetUsd: 5 },
						{ label: "Also cheap", description: "B.", setBudgetUsd: 5 },
						{ label: "Rescope", description: "C." },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options.map((o) => o.label)).toEqual(["Set budget to $5.00", "Rescope"]);
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
		expect(chosenBudgetUsd(payload, { q1: "Set budget to $4.50" })).toBe(4.5);
		expect(chosenBudgetUsd(payload, { q1: "Rescope to a subset" })).toBeUndefined();
		// "Other" text that mimics the grant wording grants nothing.
		expect(chosenBudgetUsd(payload, { q1: "set budget to $4.50 please" })).toBeUndefined();
	});

	it("tells the model the budget it now has", () => {
		const payload = { ...ok({ questions: [budgetQuestion(4.5)] }), elicitationId: "x" };
		expect(answerToToolResult(payload, "accept", { q1: "Set budget to $4.50" })).toContain(
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
		if (!result.ok) {
			expect(result.reason).toContain("setBudgetUsd");
			expect(result.reason).toContain("goes in its description, not its label");
		}
	});

	// 131 of 1,835 asks were bounced, many for options like these: the label grants
	// nothing and claims nothing, the description just says what the choice costs.
	it("passes a budget question that only states costs in descriptions", () => {
		const payload = ok({
			questions: [
				question({
					question: "The run does not fit the remaining budget. How should I proceed?",
					header: "Budget",
					options: [
						{ label: "Halve the dataset", description: "Fits: holds about $1.20 of the $2 left." },
						{ label: "Use a smaller GPU", description: "t4-small at $0.40/hr, roughly $0.80." },
					],
				}),
			],
		});
		const field = payload.fields?.[0];
		if (field?.kind !== "select") throw new Error("expected a select");
		expect(field.options.map((o) => o.label)).toEqual(["Halve the dataset", "Use a smaller GPU"]);
		expect(field.options[0].description).toContain("$1.20");
	});

	it("still bounces a dollar label when the descriptions are what look clean", () => {
		const result = normalizeAskUserQuestion({
			questions: [
				question({
					question: "Raise the budget for this run?",
					options: [
						{ label: "Raise to $5", description: "Covers the full run." },
						{ label: "Keep it as is", description: "I will rescope instead." },
					],
				}),
			],
		});
		expect(result.ok).toBe(false);
	});

	// What labels-only leaves open: the raise lives in the description, nothing funds it,
	// and the question is shown. The model must not come away thinking the click paid.
	it("tells the model an unfunded raise changed nothing, rather than rejecting the question", () => {
		const payload = {
			...ok({
				questions: [
					question({
						question: "Raise the budget for this run?",
						options: [
							{ label: "Raise the budget", description: "Set it to $5." },
							{ label: "Keep it as is", description: "I will rescope instead." },
						],
					}),
				],
			}),
			elicitationId: "x",
		};

		const result = answerToToolResult(payload, "accept", { q1: "Raise the budget" });

		expect(result).toContain("did not change the session compute budget");
		expect(result).not.toContain("budget is now");
	});

	it("says nothing about the budget for a question that is not about it", () => {
		const payload = { ...ok({ questions: [question()] }), elicitationId: "x" };
		expect(answerToToolResult(payload, "accept", { q1: "Postgres" })).not.toContain("budget");
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
