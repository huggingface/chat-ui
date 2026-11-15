/**
 * Local page for checking the miner's labels by hand on a sample of cases per family.
 *
 * Run: npm run eval:review -- --cases <dir of <family>.jsonl> [--per-family 20] [--port 5199]
 * The sample and the verdicts are kept in <cases>/review/, so a restart picks up where you left.
 * Local only: the cases are real users' conversations.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { indexCases, readCaseAt } from "../caseFile";
import { caseView } from "../digest";
import { LABELS } from "../labels";
import type { DecisionCase, Family } from "../types";

interface Indexed {
	id: string;
	conversationId: string;
	label: string;
	pass: boolean | null;
	/** from a conversation someone reported, always reviewed */
	seed: boolean;
	offset: number;
	length: number;
}

interface Verdict {
	verdict: "agree" | "disagree" | "invalid";
	/** the right label when the verdict is disagree */
	label?: string;
	note?: string;
	/** the miner's and the model's labels when the verdict was given, so a re-mine can't silently change what was agreed with */
	minerLabel?: string;
	llmLabel?: string;
	at: string;
}

const FAMILIES = Object.keys(LABELS) as Family[];

function arg(flag: string, fallback?: string): string {
	const at = process.argv.indexOf(flag);
	const value = at === -1 ? fallback : process.argv[at + 1];
	if (value === undefined) throw new Error(`missing ${flag}`);
	return value;
}

const casesDir = arg("--cases");
const perFamily = Number(arg("--per-family", "20"));
const port = Number(arg("--port", "5199"));
const reviewDir = join(casesDir, "review");
const samplePath = join(reviewDir, "sample.json");
const verdictsPath = join(reviewDir, "verdicts.json");
const annotationsPath = join(reviewDir, "annotations.json");

/** written by annotate.ts while the page runs, so read on each request */
function annotations(): Record<string, unknown> {
	return existsSync(annotationsPath) ? JSON.parse(readFileSync(annotationsPath, "utf8")) : {};
}

function indexFamily(family: Family): Indexed[] {
	return indexCases(casesDir, family).map(({ head, offset, length }) => ({
		id: head.id,
		conversationId: head.source.conversationId,
		label: head.observed.label,
		pass: head.observed.pass,
		seed: Boolean(head.source.feedback),
		offset,
		length,
	}));
}

function seeded(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const MAX_SEED_CASES = 3;

/**
 * Cases from reported conversations first, then one case per conversation with every label given
 * at least two slots so rare labels get checked too. The summary weights the verdicts back by each
 * label's share of the whole family, seeds included, so seeds only add to what is checked.
 */
function drawSample(rows: Indexed[], size: number, random: () => number): string[] {
	const seeds = rows.filter((r) => r.seed).slice(0, MAX_SEED_CASES);
	const shuffled = [...rows].filter((r) => !r.seed).sort(() => random() - 0.5);
	const pool = [...new Map(shuffled.map((r) => [r.conversationId, r])).values()];
	const byLabel = new Map<string, Indexed[]>();
	for (const row of pool) byLabel.set(row.label, [...(byLabel.get(row.label) ?? []), row]);
	size -= seeds.length;
	const quota = new Map(
		[...byLabel].map(([label, list]) => [
			label,
			Math.min(list.length, Math.max(2, Math.round((size * list.length) / pool.length))),
		])
	);
	let total = [...quota.values()].reduce((a, b) => a + b, 0);
	while (total > size) {
		const [largest] = [...quota].sort((a, b) => b[1] - a[1])[0];
		quota.set(largest, (quota.get(largest) ?? 0) - 1);
		total -= 1;
	}
	const picked = [...byLabel].flatMap(([label, list]) => list.slice(0, quota.get(label)));
	const rest = pool.filter((r) => !picked.includes(r));
	return [...seeds, ...picked, ...rest.slice(0, Math.max(0, size - picked.length))].map(
		(r) => r.id
	);
}

const index = new Map<Family, Indexed[]>();
for (const family of FAMILIES) {
	index.set(family, indexFamily(family));
	console.error(`${family}: ${index.get(family)?.length ?? 0} cases`);
}

mkdirSync(reviewDir, { recursive: true });
const sample: Record<string, string[]> = existsSync(samplePath)
	? JSON.parse(readFileSync(samplePath, "utf8"))
	: {};
for (const family of FAMILIES) {
	if (sample[family]) continue;
	sample[family] = drawSample(
		index.get(family) ?? [],
		perFamily,
		seeded(FAMILIES.indexOf(family) + 1)
	);
}
writeFileSync(samplePath, `${JSON.stringify(sample, null, 2)}\n`);

const verdicts: Record<string, Verdict> = existsSync(verdictsPath)
	? JSON.parse(readFileSync(verdictsPath, "utf8"))
	: {};

function saveVerdicts() {
	const tmp = `${verdictsPath}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(verdicts, null, 2)}\n`);
	renameSync(tmp, verdictsPath);
}

function readCase(id: string): DecisionCase | undefined {
	const family = id.split("/")[0] as Family;
	const row = index.get(family)?.find((r) => r.id === id);
	return row ? readCaseAt(casesDir, family, row) : undefined;
}

function state() {
	return {
		families: FAMILIES.map((family) => {
			const rows = index.get(family) ?? [];
			const population: Record<string, number> = {};
			for (const row of rows) population[row.label] = (population[row.label] ?? 0) + 1;
			const byId = new Map(rows.map((r) => [r.id, r]));
			return {
				family,
				labels: LABELS[family],
				population,
				total: rows.length,
				cases: (sample[family] ?? []).map((id) => {
					const row = byId.get(id);
					return { id, label: row?.label, pass: row?.pass, seed: row?.seed };
				}),
			};
		}),
		verdicts,
		annotations: annotations(),
	};
}

const page = join(dirname(fileURLToPath(import.meta.url)), "index.html");

createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	const json = (status: number, body: unknown) => {
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	if (req.method === "GET" && url.pathname === "/") {
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(readFileSync(page));
		return;
	}
	if (req.method === "GET" && url.pathname === "/api/state") return json(200, state());
	if (req.method === "GET" && url.pathname === "/api/case") {
		const found = readCase(url.searchParams.get("id") ?? "");
		return found
			? json(200, { ...caseView(found), annotation: annotations()[found.id] })
			: json(404, { error: "no such case" });
	}
	if (req.method === "POST" && url.pathname === "/api/verdict") {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			const { id, verdict, label, note, minerLabel, llmLabel } = JSON.parse(body) as Verdict & {
				id: string;
			};
			if (verdict === null) delete verdicts[id];
			else
				verdicts[id] = { verdict, label, note, minerLabel, llmLabel, at: new Date().toISOString() };
			saveVerdicts();
			json(200, { ok: true });
		});
		return;
	}
	json(404, { error: "not found" });
}).listen(port, () => console.error(`review on http://localhost:${port}`));
