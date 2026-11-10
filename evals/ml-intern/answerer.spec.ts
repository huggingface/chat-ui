import { describe, expect, it } from "vitest";
import {
	ANSWER_MODEL,
	ANSWER_TEMPERATURE,
	answerElicitation,
	fallbackValue,
	letterChoices,
	letterRequest,
	optionLogprobs,
	parseJsonAnswers,
	routerComplete,
	softmax,
	validValue,
	type Complete,
	type Completion,
	type ElicitationField,
} from "./answerer.ts";

// real gemma replies from the calibration trial
const SURE_A = [
	{ token: "A", logprob: 0 },
	{ token: "激", logprob: -16.8125 },
	{ token: " A", logprob: -16.9375 },
	{ token: " Balancing", logprob: -17.5 },
];
const SURE_B = [
	{ token: "B", logprob: 0 },
	{ token: " B", logprob: -15.9375 },
	{ token: "**", logprob: -18.625 },
];
const TORN = [
	{ token: "A", logprob: -0.6326 },
	{ token: "B", logprob: -0.7576 },
	{ token: "C", logprob: -11.8826 },
	{ token: " A", logprob: -14.0701 },
];

const hardware: ElicitationField = {
	kind: "select",
	name: "where",
	title: "Where should the training run?",
	multiple: false,
	options: [
		{ value: "a", label: "24 GB GPU (A10G small)" },
		{
			value: "b",
			label: "80 GB GPU (A100)",
			description: "Recommended: room for a full fine-tune",
		},
		{ value: "c", label: "CPU only" },
	],
};
const overBudget: ElicitationField = {
	kind: "select",
	name: "next",
	title: "Training needs about $6 more than your budget. What should I do?",
	multiple: false,
	options: [
		{ value: "raise", label: "Raise the budget to $10 (Recommended)", setBudgetUsd: 10 },
		{ value: "cut", label: "Cut to 1 epoch so it fits in $5" },
		{ value: "stop", label: "Stop here" },
	],
};
const isPublic: ElicitationField = {
	kind: "boolean",
	name: "public",
	title: "Push the trained model as a public repo?",
};
const epochs: ElicitationField = {
	kind: "number",
	name: "epochs",
	title: "How many epochs should I train for?",
	default: 3,
	minimum: 1,
};
const spaceName: ElicitationField = {
	kind: "string",
	name: "name",
	title: "What should I call the Space?",
};

type Top = Extract<Completion, { ok: true }>["top"];
const ok = (top: Top, provider = "openrouter"): Completion => ({
	ok: true,
	content: "",
	top,
	provider,
});

function fake(...replies: Completion[]): Complete & { bodies: Array<Record<string, unknown>> } {
	const bodies: Array<Record<string, unknown>> = [];
	const complete = async (body: Record<string, unknown>) => {
		bodies.push(body);
		return replies.shift() ?? { ok: false as const, error: "no reply left" };
	};
	return Object.assign(complete, { bodies });
}

describe("optionLogprobs", () => {
	it("sums the spellings of a letter and floors letters outside the top list", () => {
		const lp = optionLogprobs(SURE_A, 3);
		expect(lp[0]).toBeCloseTo(Math.log(Math.exp(0) + Math.exp(-16.9375)), 10);
		expect(lp[1]).toBe(-17.5 - 1);
		expect(lp[2]).toBe(-17.5 - 1);
	});

	it("reads letters wrapped in brackets or bold", () => {
		const lp = optionLogprobs(
			[
				{ token: "(B)", logprob: -0.1 },
				{ token: "**A", logprob: -3 },
			],
			2
		);
		expect(lp[0]).toBe(-3);
		expect(lp[1]).toBeCloseTo(-0.1, 10);
	});
});

describe("softmax at the fitted temperature", () => {
	it("keeps a sure answer sure and a torn one under the confidence bar", () => {
		const sure = softmax(optionLogprobs(SURE_A, 3), ANSWER_TEMPERATURE);
		expect(sure[0]).toBeGreaterThan(0.9);
		const torn = softmax(optionLogprobs(TORN, 2), ANSWER_TEMPERATURE);
		expect(torn[0]).toBeCloseTo(0.505, 3);
		expect(torn.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
	});
});

describe("letterChoices and letterRequest", () => {
	it("leaves budget options out and letters the rest with their descriptions", () => {
		expect(letterChoices(overBudget).map((c) => c.value)).toEqual(["cut", "stop"]);
		const body = letterRequest("Brief.", hardware, letterChoices(hardware));
		expect(body).toMatchObject({ model: ANSWER_MODEL, max_tokens: 1, top_logprobs: 20 });
		const user = body.messages[1].content;
		expect(user).toContain("A) 24 GB GPU (A10G small)");
		expect(user).toContain("B) 80 GB GPU (A100) (Recommended: room for a full fine-tune)");
		expect(user.endsWith("C) CPU only\n\nAnswer:")).toBe(true);
	});

	it("offers true and false for a boolean", () => {
		expect(letterChoices(isPublic).map((c) => c.value)).toEqual([true, false]);
	});
});

describe("fallbackValue", () => {
	it("takes the recommended option, never a budget one, else the first", () => {
		expect(fallbackValue(hardware)).toBe("b");
		expect(fallbackValue(overBudget)).toBe("cut");
		expect(
			fallbackValue({ ...hardware, multiple: true, options: hardware.options.slice(2) })
		).toEqual(["c"]);
	});

	it("takes the field default, else the minimum or best judgment", () => {
		expect(fallbackValue(epochs)).toBe(3);
		expect(fallbackValue({ ...epochs, default: undefined })).toBe(1);
		expect(fallbackValue(spaceName)).toBe("Use your best judgment.");
		expect(fallbackValue(isPublic)).toBe(true);
	});
});

describe("validValue and parseJsonAnswers", () => {
	it("wants a finite number at or above the minimum and a non-empty string", () => {
		expect(validValue(epochs, 2)).toBe(2);
		expect(validValue(epochs, "2")).toBeUndefined();
		expect(validValue(epochs, 0)).toBeUndefined();
		expect(validValue(epochs, Number.NaN)).toBeUndefined();
		expect(validValue(spaceName, " sentiment-demo ")).toBe("sentiment-demo");
		expect(validValue(spaceName, "")).toBeUndefined();
	});

	it("reads the answers object out of a reply with text around it", () => {
		expect(parseJsonAnswers('Sure: {"answers": {"epochs": 2}}')).toEqual({ epochs: 2 });
		expect(parseJsonAnswers("{not json")).toBeUndefined();
		expect(parseJsonAnswers('{"epochs": 2}')).toBeUndefined();
	});
});

describe("answerElicitation", () => {
	it("answers with the top option and records its probabilities", async () => {
		const complete = fake(ok(SURE_A));
		const [a] = await answerElicitation("Brief.", [hardware], complete);
		expect(a).toMatchObject({
			name: "where",
			value: "a",
			source: "model",
			model: ANSWER_MODEL,
			provider: "openrouter",
			temperature: ANSWER_TEMPERATURE,
		});
		expect(a.confidence).toBeGreaterThan(0.9);
		expect(Object.keys(a.probabilities ?? {})).toEqual(["a", "b", "c"]);
		expect(a.promptHash).toMatch(/^[0-9a-f]{12}$/);
	});

	it("falls back to the recommended option below the confidence bar", async () => {
		const field = { ...hardware, options: hardware.options.slice(0, 2) };
		const [a] = await answerElicitation("Brief.", [field], fake(ok(TORN)));
		expect(a).toMatchObject({ value: "b", source: "fallback", reason: "low confidence" });
		expect(a.confidence).toBeCloseTo(0.505, 3);
	});

	it("falls back when the call fails or returns no logprobs", async () => {
		const [failed] = await answerElicitation(
			"Brief.",
			[hardware],
			fake({ ok: false, error: "HTTP 429" })
		);
		expect(failed).toMatchObject({ value: "b", reason: "call failed", error: "HTTP 429" });
		const [bare] = await answerElicitation("Brief.", [hardware], fake(ok(undefined)));
		expect(bare).toMatchObject({ value: "b", reason: "call failed", error: "no logprobs" });
	});

	it("answers a boolean as true or false", async () => {
		const [a] = await answerElicitation("Everything stays private.", [isPublic], fake(ok(SURE_B)));
		expect(a).toMatchObject({ value: false, source: "model" });
	});

	it("never offers a budget option, so a letter maps past it", async () => {
		const complete = fake(ok(SURE_A));
		const [a] = await answerElicitation("Brief.", [overBudget], complete);
		expect(a.value).toBe("cut");
		expect(JSON.stringify(complete.bodies[0])).not.toContain("Raise the budget");
	});

	it("takes a lone option without a call", async () => {
		const complete = fake();
		const field = { ...hardware, options: hardware.options.slice(0, 1) };
		expect(await answerElicitation("Brief.", [field], complete)).toEqual([
			{ name: "where", value: "a", source: "fallback", reason: "one option" },
		]);
		expect(complete.bodies).toHaveLength(0);
	});

	it("answers number and string fields in one json call, validated, in field order", async () => {
		const complete = fake(
			{ ok: true, content: '{"answers": {"epochs": "two", "name": "sentiment-demo"}}' },
			ok(SURE_A)
		);
		const answers = await answerElicitation("Brief.", [hardware, epochs, spaceName], complete);
		expect(answers.map((a) => [a.name, a.value, a.source])).toEqual([
			["where", "a", "model"],
			["epochs", 3, "fallback"],
			["name", "sentiment-demo", "model"],
		]);
		expect(answers[1].reason).toBe("invalid reply");
		expect(complete.bodies[0]).toMatchObject({ response_format: { type: "json_object" } });
	});
});

describe("multiple choice", () => {
	const metrics: ElicitationField = {
		kind: "select",
		name: "metrics",
		title: "Which metrics should the dashboard show?",
		multiple: true,
		options: [
			{ value: "acc", label: "Accuracy" },
			{ value: "loss", label: "Training loss" },
			{ value: "more", label: "Everything, raise the budget to $20", setBudgetUsd: 20 },
		],
	};

	it("goes to the json call without budget options and keeps a valid subset", async () => {
		const complete = fake({
			ok: true,
			content: '{"answers": {"metrics": ["acc", "loss", "acc"]}}',
		});
		const [a] = await answerElicitation("Brief.", [metrics], complete);
		expect(a).toMatchObject({ value: ["acc", "loss"], source: "model" });
		expect(JSON.stringify(complete.bodies[0])).not.toContain("raise the budget");
	});

	it("refuses a budget value or an unknown one", () => {
		expect(validValue(metrics, ["acc", "more"])).toBeUndefined();
		expect(validValue(metrics, ["f1"])).toBeUndefined();
		expect(validValue(metrics, [])).toBeUndefined();
	});
});

describe("routerComplete", () => {
	const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), { status, headers });

	it("backs off on 429 for as long as retry-after says, then reads logprobs and the provider", async () => {
		const waits: number[] = [];
		const replies = [
			response(429, {}, { "retry-after": "5" }),
			response(
				200,
				{
					choices: [
						{ message: { content: "A" }, logprobs: { content: [{ top_logprobs: SURE_A }] } },
					],
				},
				{ "x-inference-provider": "openrouter" }
			),
		];
		const complete = routerComplete("https://router.example/v1/", "key", {
			fetchImpl: async () => replies.shift() as Response,
			wait: async (ms) => void waits.push(ms),
		});
		const res = await complete({});
		expect(res).toMatchObject({ ok: true, content: "A", provider: "openrouter", top: SURE_A });
		expect(waits).toEqual([5_000]);
	});

	it("gives up on a client error and after the last try", async () => {
		const once = routerComplete("u", "k", {
			fetchImpl: async () => response(400, { error: "bad" }),
			wait: async () => {},
		});
		expect(await once({})).toMatchObject({ ok: false, error: expect.stringContaining("HTTP 400") });

		let calls = 0;
		const busy = routerComplete("u", "k", {
			tries: 3,
			fetchImpl: async () => (calls++, response(503, {})),
			wait: async () => {},
		});
		expect(await busy({})).toMatchObject({ ok: false });
		expect(calls).toBe(3);
	});
});
