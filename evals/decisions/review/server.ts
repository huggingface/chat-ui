/**
 * Local page for checking the miner's labels by hand on a sample of cases per family.
 *
 * Run: npm run eval:review -- --cases <dir of <family>.jsonl> [--per-family 20] [--port 5199]
 * The sample and the verdicts are kept in <cases>/review/, so a restart picks up where you left.
 * Local only: the cases are real users' conversations.
 */
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { toolRounds } from "$lib/utils/messageShape";
import { LABELS } from "../labels";
import type { DecisionCase, Family } from "../types";

interface Indexed {
	id: string;
	conversationId: string;
	label: string;
	pass: boolean | null;
	offset: number;
	length: number;
}

interface Verdict {
	verdict: "agree" | "disagree" | "invalid";
	/** the right label when the verdict is disagree */
	label?: string;
	note?: string;
	at: string;
}

const FAMILIES = Object.keys(LABELS) as Family[];
const TEXT_LIMIT = 4000;

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

/** reads only each line's head, the conversation is last and can be megabytes */
function indexFamily(family: Family): Indexed[] {
	const path = join(casesDir, `${family}.jsonl`);
	if (!existsSync(path)) return [];
	const buffer = readFileSync(path);
	const marker = Buffer.from(',"conversation":');
	const rows: Indexed[] = [];
	let start = 0;
	while (start < buffer.length) {
		let end = buffer.indexOf(10, start);
		if (end === -1) end = buffer.length;
		const cut = buffer.indexOf(marker, start);
		if (cut !== -1 && cut < end) {
			const head = JSON.parse(`${buffer.subarray(start, cut).toString("utf8")}}`) as DecisionCase;
			rows.push({
				id: head.id,
				conversationId: head.source.conversationId,
				label: head.observed.label,
				pass: head.observed.pass,
				offset: start,
				length: end - start,
			});
		}
		start = end + 1;
	}
	return rows;
}

function seeded(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * One case per conversation, then every label gets at least two slots so rare labels get checked
 * too. The summary weights the verdicts back by each label's share of the whole family.
 */
function drawSample(rows: Indexed[], size: number, random: () => number): string[] {
	const shuffled = [...rows].sort(() => random() - 0.5);
	const pool = [...new Map(shuffled.map((r) => [r.conversationId, r])).values()];
	const byLabel = new Map<string, Indexed[]>();
	for (const row of pool) byLabel.set(row.label, [...(byLabel.get(row.label) ?? []), row]);
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
	return [...picked, ...rest.slice(0, Math.max(0, size - picked.length))].map((r) => r.id);
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
	if (!row) return undefined;
	const fd = openSync(join(casesDir, `${family}.jsonl`), "r");
	try {
		const buffer = Buffer.alloc(row.length);
		readSync(fd, buffer, 0, row.length, row.offset);
		return JSON.parse(buffer.toString("utf8")) as DecisionCase;
	} finally {
		closeSync(fd);
	}
}

function clip(text: string | undefined, limit = TEXT_LIMIT): string {
	if (!text) return "";
	return text.length > limit
		? `${text.slice(0, limit)}\n… [${text.length - limit} more chars]`
		: text;
}

function resultText(message: Message, uuid: string): string | undefined {
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Tool || update.uuid !== uuid) continue;
		if (update.subtype === MessageToolUpdateType.Error) return `Error: ${update.message}`;
		if (update.subtype !== MessageToolUpdateType.Result) continue;
		const result = update.result;
		if (result.status === ToolResultStatus.Error) return `Error: ${result.message}`;
		return result.outputs.map((o) => (typeof o.text === "string" ? o.text : "")).join("\n");
	}
	return undefined;
}

/**
 * The script a job or sandbox call names as v-file://<name>, rebuilt from the write_file and
 * edit_file calls before the cut, so a reviewer can tell a smoke run from a full one.
 */
function virtualFiles(messages: Message[]): Map<string, string> {
	const files = new Map<string, string>();
	for (const message of messages) {
		for (const update of message.updates ?? []) {
			if (update.type !== MessageUpdateType.Tool || update.subtype !== MessageToolUpdateType.Call) {
				continue;
			}
			let args: Record<string, unknown> = {};
			try {
				args = JSON.parse(update.argumentsRaw ?? "{}");
			} catch {
				continue;
			}
			const name = typeof args.name === "string" ? args.name : undefined;
			if (!name) continue;
			if (update.call.name === "write_file" && typeof args.content === "string") {
				files.set(name, args.content);
			} else if (update.call.name === "edit_file" && Array.isArray(args.edits)) {
				let text = files.get(name) ?? "";
				for (const edit of args.edits as Array<{ old?: string; new?: string }>) {
					if (edit.old !== undefined && edit.new !== undefined)
						text = text.replace(edit.old, edit.new);
				}
				files.set(name, text);
			}
		}
	}
	return files;
}

function caseView(c: DecisionCase) {
	const messages = c.conversation.messages;
	const target = messages[messages.length - 1];
	const users = messages.filter((m) => m.from === "user");
	const rounds = toolRounds(target.updates ?? []).slice(-5);
	const previous = [...messages.slice(0, -1)].reverse().find((m) => m.from === "assistant");
	const files = virtualFiles(messages);
	const referenced = JSON.stringify(c.observed.action).match(/v-file:\/\/[\w.\-/]+/g) ?? [];
	const scripts = [...new Set(referenced)].map((ref) => {
		const name = ref.replace("v-file://", "").replace(/@v\d+$/, "");
		return { name, content: clip(files.get(name), 20000) };
	});
	return {
		id: c.id,
		family: c.family,
		model: c.model,
		date: target.createdAt,
		conversationId: c.source.conversationId,
		round: c.source.round,
		trigger: c.trigger,
		context: c.context,
		observed: c.observed,
		firstUser: clip(users[0]?.content, 2500),
		lastUser: users.length > 1 ? clip(users[users.length - 1]?.content, 2500) : "",
		previousAnswer: rounds.length < 2 ? clip(previous?.content, 2500) : "",
		rounds: rounds.map((round) => ({
			reasoning: clip(round.calls[0]?.reasoning, 2000),
			preamble: clip(round.calls[0]?.content, 1000),
			calls: round.calls.map((call) => ({
				name: call.call.name,
				args: clip(call.argumentsRaw ?? JSON.stringify(call.call.parameters), 2500),
				result: clip(resultText(target, call.uuid), 3000),
			})),
		})),
		scripts,
	};
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
					return { id, label: row?.label, pass: row?.pass };
				}),
			};
		}),
		verdicts,
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
		return found ? json(200, caseView(found)) : json(404, { error: "no such case" });
	}
	if (req.method === "POST" && url.pathname === "/api/verdict") {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			const { id, verdict, label, note } = JSON.parse(body) as Verdict & { id: string };
			if (verdict === null) delete verdicts[id];
			else verdicts[id] = { verdict, label, note, at: new Date().toISOString() };
			saveVerdicts();
			json(200, { ok: true });
		});
		return;
	}
	json(404, { error: "not found" });
}).listen(port, () => console.error(`review on http://localhost:${port}`));
