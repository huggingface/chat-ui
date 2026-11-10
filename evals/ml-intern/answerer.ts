/**
 * answers ask_user_question as the simulated user of a task
 *
 * single choice fields are lettered and the letter logprobs of the answer model, scaled by a fitted
 * temperature, give each option a probability, the rest take one json call
 */
import { createHash } from "node:crypto";

export const ANSWER_MODEL = "google/gemma-4-31B-it:novita";
/** fitted on 60 LocalLLaMA/typed-decisions questions, refit with fit_answerer.py when the model changes */
export const ANSWER_TEMPERATURE = 6.39;
export const MIN_CONFIDENCE = 0.6;
export const BEST_JUDGMENT = "Use your best judgment.";
const LETTERS = "ABCDEFGHIJKLMNOP";

export const LETTER_SYSTEM =
	"You are the user of an ML assistant, answering its question the way the user described in the brief would, " +
	"using only what the brief says or clearly implies. You have no ML opinions of your own: when the brief does not " +
	"settle the question, pick the option the assistant marks as recommended, else the first option, even if another " +
	"looks better to you. You want the task finished within your budget, so prefer an option that keeps it going " +
	"within the budget over stopping. Reply with the letter of one option, nothing else.";

export const JSON_SYSTEM =
	"You are the user of an ML assistant. It has asked you for some values. Answer the way the user described in " +
	"the brief would, using only what the brief says or clearly implies. When the brief does not settle a value, " +
	"use its default if it has one, and for free text say to use its best judgement. Reply with JSON only, in the " +
	'form {"answers": {"<field name>": <value>}}: a number for a number field, a short reply for a string field, ' +
	"a list of option values for a select field.";

export interface SelectOption {
	value: string;
	label: string;
	description?: string;
	setBudgetUsd?: number;
}

export type ElicitationField =
	| { kind: "string"; name: string; title?: string; description?: string; default?: string }
	| {
			kind: "number";
			name: string;
			title?: string;
			description?: string;
			default?: number;
			minimum?: number;
	  }
	| { kind: "boolean"; name: string; title?: string; description?: string; default?: boolean }
	| {
			kind: "select";
			name: string;
			title?: string;
			description?: string;
			multiple: boolean;
			options: SelectOption[];
	  };

export type AnswerValue = string | number | boolean | string[];

export interface FieldAnswer {
	name: string;
	value: AnswerValue;
	/** model when the answer model chose it, fallback when the recommended or default value stood in */
	source: "model" | "fallback";
	reason?: "low confidence" | "call failed" | "invalid reply" | "one option" | "too many options";
	model?: string;
	/** the provider that served the call, from x-inference-provider */
	provider?: string;
	temperature?: number;
	promptHash?: string;
	/** option value to probability, for a lettered field */
	probabilities?: Record<string, number>;
	confidence?: number;
	error?: string;
}

export type Completion =
	| {
			ok: true;
			content: string;
			top?: Array<{ token: string; logprob: number }>;
			provider?: string;
	  }
	| { ok: false; error: string; provider?: string };

export type Complete = (body: Record<string, unknown>) => Promise<Completion>;

export const promptHash = (system: string) =>
	createHash("sha256").update(system).digest("hex").slice(0, 12);

export const userBrief = (prompt: string, user: string) =>
	`You asked the assistant: "${prompt}"\n${user}`;

interface Choice {
	value: string | boolean;
	label: string;
}

/** a single choice or yes/no, answered by letter, the rest go to one json call */
export const isLettered = (field: ElicitationField) =>
	field.kind === "boolean" || (field.kind === "select" && !field.multiple);

const withoutBudget = (options: SelectOption[]) =>
	options.filter((o) => o.setBudgetUsd === undefined);

/** what a lettered field offers, budget options left out since raising the cap would move what the checks measure */
export function letterChoices(field: ElicitationField): Choice[] {
	if (field.kind === "boolean") {
		return [
			{ value: true, label: "true" },
			{ value: false, label: "false" },
		];
	}
	if (field.kind !== "select") return [];
	return withoutBudget(field.options).map((o) => ({
		value: o.value,
		label: o.description ? `${o.label} (${o.description})` : o.label,
	}));
}

export function letterRequest(brief: string, field: ElicitationField, choices: Choice[]) {
	const question = [field.title ?? field.name, field.description].filter(Boolean).join("\n");
	const lines = choices.map((c, i) => `${LETTERS[i]}) ${c.label}`).join("\n");
	return {
		model: ANSWER_MODEL,
		temperature: 0,
		max_tokens: 1,
		logprobs: true,
		top_logprobs: 20,
		messages: [
			{ role: "system", content: LETTER_SYSTEM },
			{
				role: "user",
				content: `Brief: ${brief}\n\nThe assistant asks: ${question}\n\n${lines}\n\nAnswer:`,
			},
		],
	};
}

/** the logprob of each letter, summing spellings like B and space B, a letter outside the top list gets the lowest one minus 1 */
export function optionLogprobs(
	top: Array<{ token: string; logprob: number }>,
	n: number
): number[] {
	const floor = Math.min(...top.map((t) => t.logprob)) - 1;
	return Array.from({ length: n }, (_, i) => {
		const matches = top.filter(
			(t) =>
				t.token
					.trim()
					.replace(/^[()*.]+|[()*.]+$/g, "")
					.toUpperCase() === LETTERS[i]
		);
		return matches.length ? Math.log(matches.reduce((s, t) => s + Math.exp(t.logprob), 0)) : floor;
	});
}

export function softmax(xs: number[], temperature: number): number[] {
	const scaled = xs.map((x) => x / temperature);
	const max = Math.max(...scaled);
	const e = scaled.map((x) => Math.exp(x - max));
	const sum = e.reduce((s, x) => s + x, 0);
	return e.map((x) => x / sum);
}

/** what stands in when the model cannot answer, the recommended option else the first, or the field default */
export function fallbackValue(field: ElicitationField): AnswerValue {
	switch (field.kind) {
		case "string":
			return field.default ?? BEST_JUDGMENT;
		case "number":
			return field.default ?? field.minimum ?? 1;
		case "boolean":
			return field.default ?? true;
		case "select": {
			const pool = field.options.filter((o) => o.setBudgetUsd === undefined);
			const picked =
				pool.find((o) => /recommend/i.test(`${o.label} ${o.description ?? ""}`)) ?? pool[0];
			return field.multiple ? [picked.value] : picked.value;
		}
	}
}

/** a json reply value, or undefined when it does not fit the field */
export function validValue(field: ElicitationField, value: unknown): AnswerValue | undefined {
	if (field.kind === "number") {
		if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
		return field.minimum !== undefined && value < field.minimum ? undefined : value;
	}
	if (field.kind === "string") {
		return typeof value === "string" && value.trim() ? value.trim() : undefined;
	}
	if (field.kind === "select" && field.multiple && Array.isArray(value) && value.length) {
		const allowed = new Set(withoutBudget(field.options).map((o) => o.value));
		const picked = [...new Set(value)];
		return picked.every((v): v is string => typeof v === "string" && allowed.has(v))
			? picked
			: undefined;
	}
	return undefined;
}

export function jsonRequest(brief: string, fields: ElicitationField[]) {
	const shown = fields.map((f) =>
		f.kind === "select" ? { ...f, options: withoutBudget(f.options) } : f
	);
	return {
		model: ANSWER_MODEL,
		temperature: 0,
		max_tokens: 500,
		response_format: { type: "json_object" },
		messages: [
			{ role: "system", content: JSON_SYSTEM },
			{
				role: "user",
				content: `Brief: ${brief}\n\nQuestion fields:\n${JSON.stringify(shown, null, 1)}`,
			},
		],
	};
}

export function parseJsonAnswers(content: string): Record<string, unknown> | undefined {
	const found = content.match(/\{[\s\S]*\}/);
	if (!found) return undefined;
	try {
		const answers = (JSON.parse(found[0]) as { answers?: unknown }).answers;
		return answers && typeof answers === "object"
			? (answers as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

async function answerLettered(
	brief: string,
	field: ElicitationField,
	complete: Complete
): Promise<FieldAnswer> {
	const choices = letterChoices(field);
	if (choices.length === 1) {
		return {
			name: field.name,
			value: choices[0].value,
			source: "fallback",
			reason: "one option",
		};
	}
	const fallback = { name: field.name, value: fallbackValue(field), source: "fallback" as const };
	if (choices.length > LETTERS.length) return { ...fallback, reason: "too many options" };

	const meta = {
		model: ANSWER_MODEL,
		temperature: ANSWER_TEMPERATURE,
		promptHash: promptHash(LETTER_SYSTEM),
	};
	const res = await complete(letterRequest(brief, field, choices));
	if (!res.ok)
		return {
			...fallback,
			...meta,
			provider: res.provider,
			reason: "call failed",
			error: res.error,
		};
	if (!res.top?.length) {
		return {
			...fallback,
			...meta,
			provider: res.provider,
			reason: "call failed",
			error: "no logprobs",
		};
	}
	const p = softmax(optionLogprobs(res.top, choices.length), ANSWER_TEMPERATURE);
	const best = p.indexOf(Math.max(...p));
	const scored = {
		...meta,
		provider: res.provider,
		probabilities: Object.fromEntries(choices.map((c, i) => [String(c.value), p[i]])),
		confidence: p[best],
	};
	if (p[best] < MIN_CONFIDENCE) return { ...fallback, ...scored, reason: "low confidence" };
	return { name: field.name, value: choices[best].value, source: "model", ...scored };
}

async function answerFree(
	brief: string,
	fields: ElicitationField[],
	complete: Complete
): Promise<FieldAnswer[]> {
	const meta = { model: ANSWER_MODEL, promptHash: promptHash(JSON_SYSTEM) };
	const res = await complete(jsonRequest(brief, fields));
	const answers = res.ok ? parseJsonAnswers(res.content) : undefined;
	return fields.map((field) => {
		const value = answers ? validValue(field, answers[field.name]) : undefined;
		if (value !== undefined) {
			return { name: field.name, value, source: "model", ...meta, provider: res.provider };
		}
		return {
			name: field.name,
			value: fallbackValue(field),
			source: "fallback",
			...meta,
			provider: res.provider,
			reason: res.ok ? "invalid reply" : "call failed",
			...(res.ok ? {} : { error: res.error }),
		};
	});
}

/** one answer per field in field order, never throws, a failed call falls back */
export async function answerElicitation(
	brief: string,
	fields: ElicitationField[],
	complete: Complete
): Promise<FieldAnswer[]> {
	const free = fields.filter((f) => !isLettered(f));
	const byName = new Map<string, FieldAnswer>();
	if (free.length) {
		for (const a of await answerFree(brief, free, complete)) byName.set(a.name, a);
	}
	for (const field of fields) {
		if (isLettered(field)) {
			byName.set(field.name, await answerLettered(brief, field, complete));
		}
	}
	return fields.map((f) => byName.get(f.name) as FieldAnswer);
}

/** a router chat completion that backs off on 429 and 5xx, honouring retry-after */
export function routerComplete(
	baseUrl: string,
	apiKey: string,
	{
		tries = 10,
		fetchImpl = fetch,
		wait = (ms: number) => new Promise((r) => setTimeout(r, ms)),
	} = {}
): Complete {
	return async (body) => {
		let last = "";
		let provider: string | undefined;
		for (let attempt = 0; attempt < tries; attempt++) {
			let res: Response;
			try {
				res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
					method: "POST",
					headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(120_000),
				});
			} catch (err) {
				last = String(err);
				await wait(5_000 + attempt * 1_000);
				continue;
			}
			provider = res.headers.get("x-inference-provider") ?? undefined;
			if (res.ok) {
				const data = (await res.json()) as {
					choices?: Array<{
						message?: { content?: string };
						logprobs?: {
							content?: Array<{ top_logprobs?: Array<{ token: string; logprob: number }> }>;
						};
					}>;
				};
				const choice = data.choices?.[0];
				return {
					ok: true,
					content: choice?.message?.content ?? "",
					top: choice?.logprobs?.content?.[0]?.top_logprobs,
					provider,
				};
			}
			last = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
			if (res.status !== 429 && res.status < 500) break;
			const after = Number(res.headers.get("retry-after"));
			await wait((Number.isFinite(after) && after > 0 ? after : 5) * 1_000 + attempt * 1_000);
		}
		return { ok: false, error: last, provider };
	};
}
