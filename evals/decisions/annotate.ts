/**
 * Has a model read each case and write what happened, its own label and why, so a reviewer checks
 * a judgement instead of reading the trace.
 *
 * Run: npm run eval:annotate -- --cases <dir> [--all] [--force] [--model <id:provider>] [--concurrency 6]
 * Annotates the review sample by default and caches results in <cases>/review/annotations.json.
 * Then writes <cases>/references.jsonl, each case's reference label (a reviewer's verdict where
 * there is one, the model's otherwise), and <cases>/reference-summary.json, production's
 * right-call rate per family from those labels.
 * Cases are real users' conversations, see judge.ts on picking the model.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { indexCases, readCaseAt, type CaseRow } from "./caseFile";
import { DEFAULT_JUDGE, hfToken, judge, type Judgement } from "./judge";
import { LABELS } from "./labels";
import { bootstrap, groupBy } from "./stats";
import type { Family } from "./types";

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

interface Verdict {
	verdict: "agree" | "disagree" | "invalid";
	label?: string;
	minerLabel?: string;
}

interface Reference {
	id: string;
	family: Family;
	conversationId: string;
	/** null when the trigger was judged not to belong to the family */
	label: string | null;
	pass: boolean | null;
	by: "reviewer" | "model";
	model?: string;
	summary?: string;
	rationale?: string;
}

function reference(
	family: Family,
	row: CaseRow,
	annotation: Judgement | undefined,
	verdict: Verdict | undefined
): Reference | undefined {
	const base = { id: row.head.id, family, conversationId: row.head.source.conversationId };
	const notes = { summary: annotation?.summary, rationale: annotation?.rationale };
	if (verdict) {
		const label =
			verdict.verdict === "invalid"
				? null
				: verdict.verdict === "agree"
					? (verdict.minerLabel ?? row.head.observed.label)
					: (verdict.label ?? null);
		return { ...base, label, pass: label ? LABELS[family][label] : null, by: "reviewer", ...notes };
	}
	if (!annotation) return undefined;
	const label = annotation.triggerValid ? annotation.label : null;
	return {
		...base,
		label,
		pass: label ? annotation.pass : null,
		by: "model",
		model: annotation.model,
		...notes,
	};
}

function rate(refs: Reference[]): { rate: number | null; low: number | null; high: number | null } {
	const judged = refs.filter((r) => r.pass !== null);
	const { value, low, high } = bootstrap(
		groupBy(judged, (r) => r.conversationId),
		(list) => (list.length ? list.filter((r) => r.pass).length / list.length : null)
	);
	return { rate: value, low, high };
}

function writeReferences(
	dir: string,
	rows: Map<Family, CaseRow[]>,
	annotations: Record<string, Judgement>
) {
	const verdictsPath = join(dir, "review", "verdicts.json");
	const verdicts: Record<string, Verdict> = existsSync(verdictsPath)
		? JSON.parse(readFileSync(verdictsPath, "utf8"))
		: {};
	const all: Reference[] = [];
	const summary: Record<string, unknown> = {};
	for (const [family, list] of rows) {
		const refs = list
			.map((row) => reference(family, row, annotations[row.head.id], verdicts[row.head.id]))
			.filter((r): r is Reference => r !== undefined);
		all.push(...refs);
		const labels: Record<string, number> = {};
		for (const r of refs)
			labels[r.label ?? "not-this-family"] = (labels[r.label ?? "not-this-family"] ?? 0) + 1;
		summary[family] = {
			cases: list.length,
			labelled: refs.length,
			byReviewer: refs.filter((r) => r.by === "reviewer").length,
			conversations: new Set(refs.map((r) => r.conversationId)).size,
			rightCall: rate(refs),
			labels: Object.fromEntries(Object.entries(labels).sort((a, b) => b[1] - a[1])),
		};
	}
	writeFileSync(join(dir, "references.jsonl"), all.map((r) => JSON.stringify(r)).join("\n") + "\n");
	writeFileSync(join(dir, "reference-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify(summary, null, 2));
}

async function main() {
	const dir = arg("--cases");
	if (!dir) throw new Error("usage: --cases <dir> [--all] [--force] [--model <id:provider>]");
	const model = arg("--model") ?? DEFAULT_JUDGE;
	const concurrency = Number(arg("--concurrency") ?? 6);
	const path = join(dir, "review", "annotations.json");
	const done: Record<string, Judgement> = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: {};
	const sample = JSON.parse(readFileSync(join(dir, "review", "sample.json"), "utf8")) as Record<
		string,
		string[]
	>;
	const inSample = new Set(Object.values(sample).flat());
	const all = process.argv.includes("--all");
	const force = process.argv.includes("--force");
	const rows = new Map((Object.keys(LABELS) as Family[]).map((f) => [f, indexCases(dir, f)]));
	const todo = [...rows].flatMap(([family, list]) =>
		list
			.filter((row) => all || inSample.has(row.head.id))
			.filter((row) => force || done[row.head.id]?.model !== model)
			.map((row) => ({ family, row }))
	);
	console.error(`${todo.length} cases to annotate with ${model}`);

	const key = hfToken();
	const save = () => {
		writeFileSync(`${path}.tmp`, `${JSON.stringify(done, null, 2)}\n`);
		renameSync(`${path}.tmp`, path);
	};
	let next = 0;
	let failed = 0;
	await Promise.all(
		Array.from({ length: concurrency }, async () => {
			while (next < todo.length) {
				const { family, row } = todo[next++];
				const c = readCaseAt(dir, family, row);
				try {
					done[c.id] = await judge(c, { model, key });
					save();
					console.error(`${next}/${todo.length} ${c.id} → ${done[c.id].label}`);
				} catch (error) {
					failed += 1;
					console.error(`${c.id} failed: ${error instanceof Error ? error.message : error}`);
				}
			}
		})
	);
	console.error(`done, ${failed} failed`);
	writeReferences(dir, rows, done);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
