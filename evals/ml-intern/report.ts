import {
	holm,
	pairedBootstrap,
	permutationP,
	type Interval,
	type PairedCase,
} from "../decisions/stats.ts";
import type { FieldAnswer } from "./answerer.ts";
import type { ArtifactKind, ConversationMetrics, ScenarioOutcome } from "./scenarios.ts";

/** one task run from result.json, a crashed run has no outcome */
export interface ArmRun {
	name: string;
	repeat: number;
	passed?: boolean;
	timeoutMinutes?: number;
	artifacts?: ArtifactKind[];
	outcome?: Partial<ScenarioOutcome>;
	answers?: Array<{ fields?: FieldAnswer[] }>;
}

export interface Arm {
	sha: string;
	scenarios: ArmRun[];
}

type Value = number | boolean | undefined;

export interface Measure {
	key: string;
	label: string;
	better: "higher" | "lower";
	/** tested together under one holm correction, the rest are only shown */
	headline: boolean;
	/** shown as a percentage though each run gives a fraction */
	share?: boolean;
	value: (run: ArmRun) => Value;
}

const metric = (run: ArmRun, key: keyof ConversationMetrics): number | undefined => {
	const value = run.outcome?.metrics?.[key];
	return typeof value === "number" ? value : undefined;
};

/** minutes until the last artifact the task asks for was usable, the timeout when one never was */
function minutesToArtifacts(run: ArmRun): number | undefined {
	const kinds = run.artifacts ?? [];
	const seen = run.outcome?.artifactMinutes;
	if (kinds.length === 0 || !seen || run.timeoutMinutes === undefined) return undefined;
	const times = kinds.map((k) => seen[k]);
	return times.some((t) => t == null) ? run.timeoutMinutes : Math.max(...(times as number[]));
}

/** share of lettered answers in the run where the recommended option stood in for the answer model */
function answersFallenBack(run: ArmRun): number | undefined {
	const scored = (run.answers ?? [])
		.flatMap((a) => a.fields ?? [])
		.filter((f) => f.temperature !== undefined);
	if (scored.length === 0) return undefined;
	return scored.filter((f) => f.source === "fallback").length / scored.length;
}

export const MEASURES: Measure[] = [
	{
		key: "hidden",
		label: "hidden check passed",
		better: "higher",
		headline: true,
		value: (r) => r.outcome?.hidden?.pass,
	},
	{
		key: "artifacts",
		label: "made every artifact",
		better: "higher",
		headline: true,
		value: (r) => {
			const kinds = r.artifacts ?? [];
			const seen = r.outcome?.artifactMinutes;
			return kinds.length && seen ? kinds.every((k) => seen[k] != null) : undefined;
		},
	},
	{
		key: "minutesToArtifacts",
		label: "minutes to every artifact (timeout if never)",
		better: "lower",
		headline: true,
		value: minutesToArtifacts,
	},
	{
		key: "failed",
		label: "failed jobs",
		better: "lower",
		headline: true,
		value: (r) => metric(r, "failed"),
	},
	{
		key: "sandboxOnFlavor",
		label: "sandbox on the job's flavor before the first GPU job",
		better: "higher",
		headline: true,
		value: (r) => {
			const v = metric(r, "sandbox_on_flavor_before_first_gpu_job");
			return v === undefined ? undefined : v === 1;
		},
	},
	{
		key: "cost",
		label: "cost (USD)",
		better: "lower",
		headline: true,
		value: (r) => r.outcome?.costUsd,
	},
	{
		key: "passed",
		label: "every check passed",
		better: "higher",
		headline: false,
		value: (r) => r.passed === true,
	},
	{
		key: "minutes",
		label: "wall minutes",
		better: "lower",
		headline: false,
		value: (r) => (r.outcome?.durationSec === undefined ? undefined : r.outcome.durationSec / 60),
	},
	{
		key: "firstArtifact",
		label: "minutes to first artifact (production definition)",
		better: "lower",
		headline: false,
		value: (r) => metric(r, "minutes_to_first_artifact"),
	},
	{
		key: "jobs",
		label: "jobs submitted",
		better: "lower",
		headline: false,
		value: (r) => metric(r, "jobs"),
	},
	{
		key: "afterFailure",
		label: "a sandbox after a failed job, share of failures",
		better: "higher",
		headline: false,
		value: (r) => {
			const sandbox = metric(r, "after_failure_sandbox") ?? 0;
			const resubmit = metric(r, "after_failure_resubmit") ?? 0;
			return sandbox + resubmit ? sandbox / (sandbox + resubmit) : undefined;
		},
	},
	{
		key: "refusals",
		label: "sandbox-first refusals",
		better: "lower",
		headline: false,
		value: (r) => metric(r, "sandbox_first_refusals"),
	},
	{
		key: "answersFallenBack",
		label: "user answers below the confidence bar or failed",
		better: "lower",
		headline: false,
		share: true,
		value: answersFallenBack,
	},
];

export interface Row {
	key: string;
	label: string;
	headline: boolean;
	kind: "share" | "number";
	tasks: number;
	a: Interval;
	b: Interval;
	diff: Interval;
	p: number | null;
	pHolm: number | null;
	/** worse or better in B by the holm corrected p, headline measures only */
	direction: "worse" | "better" | null;
}

/** one case per task holding its repeats in each arm, tasks one arm never measured drop out */
export function pairedCases(a: Arm, b: Arm, measure: Measure): PairedCase[] {
	const tasks = [...new Set([...a.scenarios, ...b.scenarios].map((r) => r.name))];
	const values = (arm: Arm, task: string) =>
		arm.scenarios
			.filter((r) => r.name === task)
			.map(measure.value)
			.filter((v): v is number | boolean => v !== undefined);
	return tasks
		.map((task) => ({ conversationId: task, a: values(a, task), b: values(b, task) }))
		.filter((c) => c.a.length > 0 && c.b.length > 0);
}

const NONE: Interval = { value: null, low: null, high: null };

export function compareArms(a: Arm, b: Arm, measures = MEASURES): Row[] {
	const rows = measures.map((measure) => {
		const cases = pairedCases(a, b, measure);
		const kind =
			measure.share || cases.some((c) => [...c.a, ...c.b].some((v) => typeof v === "boolean"))
				? ("share" as const)
				: ("number" as const);
		const intervals = cases.length ? pairedBootstrap(cases) : { a: NONE, b: NONE, diff: NONE };
		return {
			key: measure.key,
			label: measure.label,
			headline: measure.headline,
			kind,
			tasks: cases.length,
			...intervals,
			p: cases.length ? permutationP(cases) : null,
			pHolm: null as number | null,
			direction: null as Row["direction"],
		};
	});
	const headline = rows.filter((r) => r.headline);
	holm(headline.map((r) => r.p)).forEach((p, i) => {
		const row = headline[i];
		row.pHolm = p;
		const diff = row.diff.value;
		if (p === null || p >= 0.05 || diff === null || diff === 0) return;
		const better = measures.find((m) => m.key === row.key)?.better;
		row.direction = diff > 0 === (better === "higher") ? "better" : "worse";
	});
	return rows;
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x === null ? "–" : x.toFixed(x >= 10 ? 0 : 2));
const signed = (x: number | null, kind: Row["kind"]) =>
	x === null ? "–" : `${x > 0 ? "+" : ""}${kind === "share" ? pct(x) : num(x)}`;

export const COMMENT_MARKER = "<!-- ml-intern-eval -->";

export function markdown(a: Arm, b: Arm, rows: Row[]): string {
	const worse = rows.filter((r) => r.direction === "worse").map((r) => r.label);
	const better = rows.filter((r) => r.direction === "better").map((r) => r.label);
	const verdict = worse.length
		? `worse on ${worse.join(", ")}`
		: better.length
			? `better on ${better.join(", ")}`
			: "no clear change";
	const show = (i: Interval, kind: Row["kind"]) => (kind === "share" ? pct(i.value) : num(i.value));
	const lines = [
		COMMENT_MARKER,
		`## ML Intern outcome eval: ${verdict}`,
		"",
		`A \`${a.sha.slice(0, 8)}\` vs B \`${b.sha.slice(0, 8)}\`, ${a.scenarios.length} and ${b.scenarios.length} task runs. ` +
			"Report-only until an A/A run sets the noise floor. Headline measures are tested together with a Holm correction; the rest are shown, not tested.",
		"",
		"| measure | A | B | B − A [95% CI] | p (Holm) | tasks |",
		"|---|---|---|---|---|---|",
	];
	for (const r of rows) {
		const ci = `${signed(r.diff.value, r.kind)} [${signed(r.diff.low, r.kind)}, ${signed(r.diff.high, r.kind)}]`;
		const p = r.p === null ? "–" : r.headline ? `${r.p} (${r.pHolm ?? "–"})` : `${r.p} (–)`;
		const label = r.headline ? `**${r.label}**` : r.label;
		lines.push(
			`| ${label} | ${show(r.a, r.kind)} | ${show(r.b, r.kind)} | ${ci} | ${p} | ${r.tasks} |`
		);
	}
	lines.push(
		"",
		"| task | checks passed A | B | failed jobs A | B | minutes A | B |",
		"|---|---|---|---|---|---|---|"
	);
	const tasks = [...new Set([...a.scenarios, ...b.scenarios].map((r) => r.name))];
	const perTask = (arm: Arm, task: string, measure: Measure) => {
		const values = arm.scenarios
			.filter((r) => r.name === task)
			.map(measure.value)
			.filter((v): v is number | boolean => v !== undefined)
			.map(Number);
		return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
	};
	const byKey = (key: string) => MEASURES.find((m) => m.key === key) as Measure;
	for (const task of tasks) {
		const cells = ["passed", "failed", "minutes"].flatMap((key) => {
			const m = byKey(key);
			const format = key === "passed" ? pct : num;
			return [format(perTask(a, task, m)), format(perTask(b, task, m))];
		});
		lines.push(`| ${task} | ${cells.join(" | ")} |`);
	}
	return lines.join("\n");
}
