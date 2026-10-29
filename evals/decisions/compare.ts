/**
 * Compares two eval arms (run dirs from eval:run) case by case.
 *
 * Run: npm run eval:compare -- --cases <dir> --a <run dir> --b <run dir> [--judge <id:provider>]
 *   [--concurrency 8] [--out <file>]
 * Every sample is judged by a model (judge.ts) that never learns which arm it came from, and also
 * labelled by labels.ts. The judge's verdict is the score; the rules are a free cross-check: if
 * they disagree with the judge more in one arm, the judge is reacting to something other than
 * the decision. Judgements are cached in each run dir, so a rerun only judges new samples.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { indexCases, readCaseAt, type CaseRow } from "./caseFile";
import { contextFor } from "./calls";
import { DEFAULT_JUDGE, hfToken, JUDGE_VERSION, judge, type Judgement } from "./judge";
import {
	groupBy,
	holm,
	pairedBootstrap,
	permutationP,
	type Interval,
	type PairedCase,
} from "./stats";
import type { Action, Family } from "./types";

interface Sample {
	caseId: string;
	family: Family;
	conversationId: string;
	sample: number;
	requestHash: string;
	promptHash: string;
	action?: Action;
	rules?: { label: string; pass: boolean | null };
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: string;
}

interface Arm {
	dir: string;
	meta: Record<string, unknown>;
	samples: Sample[];
	judgements: Record<string, Judgement>;
}

function arg(flag: string, fallback?: string): string {
	const at = process.argv.indexOf(flag);
	const value = at === -1 ? fallback : process.argv[at + 1];
	if (value === undefined) throw new Error(`missing ${flag}`);
	return value;
}

const key = (s: Pick<Sample, "caseId" | "sample">) => `${s.caseId}#${s.sample}`;

function loadArm(dir: string): Arm {
	const judgementsPath = join(dir, "judgements.json");
	return {
		dir,
		meta: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")),
		samples: readFileSync(join(dir, "samples.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Sample)
			.filter((s) => !s.error && s.action),
		judgements: existsSync(judgementsPath) ? JSON.parse(readFileSync(judgementsPath, "utf8")) : {},
	};
}

function saveJudgements(arm: Arm) {
	const path = join(arm.dir, "judgements.json");
	writeFileSync(`${path}.tmp`, `${JSON.stringify(arm.judgements, null, 2)}\n`);
	renameSync(`${path}.tmp`, path);
}

async function judgeAll(arms: Arm[], casesDir: string, model: string, concurrency: number) {
	const token = hfToken();
	const rows = new Map<Family, CaseRow[]>();
	const rowFor = (family: Family, id: string) => {
		if (!rows.has(family)) rows.set(family, indexCases(casesDir, family));
		return rows.get(family)?.find((r) => r.head.id === id);
	};
	// interleaved, so neither arm's samples are judged under different load or later in the run
	const todo = arms
		.flatMap((arm) =>
			arm.samples
				.filter((s) => {
					const cached = arm.judgements[key(s)];
					return cached?.model !== model || cached.version !== JUDGE_VERSION;
				})
				.map((sample) => ({ arm, sample }))
		)
		.sort((a, b) => key(a.sample).localeCompare(key(b.sample)));
	console.error(`${todo.length} samples to judge with ${model}`);
	let next = 0;
	let failed = 0;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (next < todo.length) {
				const { arm, sample } = todo[next++];
				const row = rowFor(sample.family, sample.caseId);
				if (!row || !sample.action) continue;
				const c = readCaseAt(casesDir, sample.family, row);
				try {
					// the miner's facts describe production's action; a sample may run another script
					const facts = { ...c, context: contextFor(c, sample.action) };
					arm.judgements[key(sample)] = await judge(facts, {
						model,
						key: token,
						action: sample.action,
					});
					saveJudgements(arm);
				} catch (error) {
					failed += 1;
					console.error(`${key(sample)} failed: ${error instanceof Error ? error.message : error}`);
				}
				if (next % 20 === 0) console.error(`${next}/${todo.length} judged`);
			}
		})
	);
	console.error(`judging done, ${failed} failed`);
}

type Scorer = (arm: Arm, s: Sample) => boolean | null | undefined;
const byJudge: Scorer = (arm, s) => arm.judgements[key(s)]?.pass;
const byRules: Scorer = (_arm, s) => s.rules?.pass;

interface CaseScore {
	caseId: string;
	conversationId: string;
	/** verdicts on the samples that got one */
	verdicts: boolean[];
	/** samples given no verdict (investigate, asked the user, ...) */
	unjudged: number;
	samples: number;
}

function caseScores(arm: Arm, family: Family | "all", score: Scorer): Map<string, CaseScore> {
	const scores = new Map<string, CaseScore>();
	const samples = arm.samples.filter((s) => family === "all" || s.family === family);
	for (const list of groupBy(samples, (s) => s.caseId)) {
		const verdicts = list
			.map((s) => score(arm, s))
			.filter((v): v is boolean => v === true || v === false);
		scores.set(list[0].caseId, {
			caseId: list[0].caseId,
			conversationId: list[0].conversationId,
			verdicts,
			unjudged: list.length - verdicts.length,
			samples: list.length,
		});
	}
	return scores;
}

interface Comparison {
	a: Interval;
	b: Interval;
	/** b − a over the cases both arms gave a verdict on */
	diff: Interval;
	/** two-sided, from reshuffling each case's samples between the arms */
	p: number | null;
	pairedCases: number;
	unjudgedShare: { a: number | null; b: number | null };
}

function compareArms(a: Arm, b: Arm, family: Family | "all", score: Scorer): Comparison {
	const sa = caseScores(a, family, score);
	const sb = caseScores(b, family, score);
	const paired: PairedCase[] = [...sa.values()]
		.map((x) => ({
			conversationId: x.conversationId,
			a: x.verdicts,
			b: sb.get(x.caseId)?.verdicts ?? [],
		}))
		.filter((x) => x.a.length > 0 && x.b.length > 0);
	const unjudged = (scores: Map<string, CaseScore>) => {
		const list = [...scores.values()];
		const total = list.reduce((n, s) => n + s.samples, 0);
		return total ? Number((list.reduce((n, s) => n + s.unjudged, 0) / total).toFixed(3)) : null;
	};
	return {
		...pairedBootstrap(paired),
		p: permutationP(paired),
		pairedCases: paired.length,
		unjudgedShare: { a: unjudged(sa), b: unjudged(sb) },
	};
}

/** how often the judge and the rules give the same verdict, where both give one */
function agreement(arm: Arm, family: Family | "all"): number | null {
	const both = arm.samples
		.filter((s) => family === "all" || s.family === family)
		.map((s) => [byJudge(arm, s), byRules(arm, s)])
		.filter(([j, r]) => typeof j === "boolean" && typeof r === "boolean");
	return both.length
		? Number((both.filter(([j, r]) => j === r).length / both.length).toFixed(3))
		: null;
}

/** share of the judge's verdicts that came from a step's stated plan rather than its calls */
function intentShare(arm: Arm, family: Family | "all"): number | null {
	const judged = arm.samples
		.filter((s) => family === "all" || s.family === family)
		.map((s) => arm.judgements[key(s)])
		.filter((j) => typeof j?.pass === "boolean");
	return judged.length
		? Number((judged.filter((j) => j.basis === "intent").length / judged.length).toFixed(3))
		: null;
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const interval = (i: Interval, signed = false) =>
	i.value === null
		? "–"
		: `${signed && i.value > 0 ? "+" : ""}${pct(i.value)} [${pct(i.low)}, ${pct(i.high)}]`;

async function main() {
	const casesDir = arg("--cases");
	const a = loadArm(arg("--a"));
	const b = loadArm(arg("--b"));
	const model = arg("--judge", DEFAULT_JUDGE);
	for (const field of ["model", "provider", "samples", "seed", "budgetUsd"]) {
		if (JSON.stringify(a.meta[field]) !== JSON.stringify(b.meta[field]))
			console.error(`warning: arms differ in ${field}: ${a.meta[field]} vs ${b.meta[field]}`);
	}
	if (JSON.stringify(a.meta.cases) !== JSON.stringify(b.meta.cases))
		console.error("warning: arms ran different cases; only shared ones are compared");

	await judgeAll([a, b], casesDir, model, Number(arg("--concurrency", "8")));

	const hashes = (arm: Arm) => new Map(arm.samples.map((s) => [s.caseId, s.promptHash]));
	const ha = hashes(a);
	const hb = hashes(b);
	const shared = [...ha.keys()].filter((id) => hb.has(id));
	const samePrompt = shared.filter((id) => ha.get(id) === hb.get(id)).length;

	const families = [...new Set([...a.samples, ...b.samples].map((s) => s.family))];
	const report = {
		a: { dir: a.dir, git: a.meta.git },
		b: { dir: b.dir, git: b.meta.git },
		model: a.meta.model,
		provider: a.meta.provider,
		judge: model,
		samePromptCases: `${samePrompt}/${shared.length}`,
		tokens: Object.fromEntries(
			[a, b].map((arm, i) => [
				i ? "b" : "a",
				arm.samples.reduce(
					(t, s) => ({
						prompt: t.prompt + (s.usage?.prompt_tokens ?? 0),
						completion: t.completion + (s.usage?.completion_tokens ?? 0),
					}),
					{ prompt: 0, completion: 0 }
				),
			])
		),
		results: Object.fromEntries(
			(["all", ...families] as Array<Family | "all">).map((family) => [
				family,
				{
					judge: compareArms(a, b, family, byJudge),
					rules: compareArms(a, b, family, byRules),
					judgeRulesAgreement: { a: agreement(a, family), b: agreement(b, family) },
					intentShare: { a: intentShare(a, family), b: intentShare(b, family) },
				},
			])
		),
	};
	// the families are the tests; "all" mixes their baselines and is reported, not tested
	const adjusted = holm(families.map((f) => report.results[f].judge.p));
	families.forEach((f, i) => Object.assign(report.results[f].judge, { pHolm: adjusted[i] }));
	const out = arg("--out", join(b.dir, `compare-vs-${basename(a.dir)}.json`));
	writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

	console.log(`A ${a.dir} (${(a.meta.git as { sha?: string })?.sha?.slice(0, 8)})`);
	console.log(`B ${b.dir} (${(b.meta.git as { sha?: string })?.sha?.slice(0, 8)})`);
	console.log(`same prompt and tools in ${report.samePromptCases} cases; judge ${model}\n`);
	console.log(
		"| family | A | B | B − A | p (Holm) | cases | no verdict A/B | rules B − A (p) | judge≈rules A/B |"
	);
	console.log("|---|---|---|---|---|---|---|---|---|");
	for (const [family, r] of Object.entries(report.results)) {
		console.log(
			`| ${family} | ${interval(r.judge.a)} | ${interval(r.judge.b)} | ${interval(r.judge.diff, true)} | ${r.judge.p ?? "–"} (${(r.judge as { pHolm?: number | null }).pHolm ?? "–"}) | ` +
				`${r.judge.pairedCases} | ${pct(r.judge.unjudgedShare.a)}/${pct(r.judge.unjudgedShare.b)} | ` +
				`${interval(r.rules.diff, true)} (${r.rules.p ?? "–"}) | ${pct(r.judgeRulesAgreement.a)}/${pct(r.judgeRulesAgreement.b)} |`
		);
	}
	for (const [family, r] of Object.entries(report.results)) {
		const { a: ia, b: ib } = r.intentShare;
		if (ia || ib) console.log(`${family}: ${pct(ia)}/${pct(ib)} of verdicts from a stated plan`);
	}
	console.log(`\nreport: ${out}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
