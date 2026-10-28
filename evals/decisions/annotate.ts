/**
 * Has a model read each case and write what happened, its own label and why, so a reviewer checks
 * a judgement instead of reading the trace. Mining and review only: eval runs stay scored by
 * labels.ts, never by a model.
 *
 * Run: npm run eval:annotate -- --cases <dir> [--all] [--force] [--model <id:provider>]
 * Annotates the review sample by default and caches results in <cases>/review/annotations.json.
 * Cases are real users' conversations: the model's provider sees them, so pick one that already
 * serves ML Intern in production.
 */
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { caseView } from "./digest";
import { LABELS } from "./labels";
import type { DecisionCase, Family } from "./types";

const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017:novita";
const CONCURRENCY = 6;

/** what each family asks and what its labels mean, the same rules labels.ts applies */
const RULES: Record<Family, string> = {
	"first-gpu-job":
		"Lewis's ask: develop in a sandbox before submitting jobs. The decision is the agent's first GPU job. " +
		"Right call: it goes to a sandbox now (develop-in-sandbox), or the job's script was already run or tested " +
		"in a sandbox earlier (job-after-sandboxing-script). Wrong call: it submits with no sandbox work on this " +
		"code beforehand (job-without-sandbox). job-after-other-sandbox-work means a sandbox was used, but not for " +
		"this script; say whether that sandbox work actually covered the code this job runs.",
	"after-job-failure":
		"Lewis's ask: stop submitting jobs that fail; reproduce in a sandbox first. The decision is what the agent " +
		"does after reading that a job failed. Right call: reproduce or test the fix in a sandbox before running " +
		"the job again (reproduce-in-sandbox). Wrong call: run the failed job's script again as a job, with " +
		"(fix-and-resubmit) or without (resubmit) an edit, untested. different-job: the next job runs other, " +
		"already-working code, not the failed script, so it is not a resubmit. fix-only: an edit, no job yet. " +
		"investigate: reading logs or files, no fix yet.",
	"after-oom":
		"The decision is what the agent does after a job runs out of GPU memory. Right call: change what uses the " +
		"memory (batch size, sequence length, gradient checkpointing or accumulation, quantisation, freeing " +
		"models), with or without a bigger GPU (fix-memory, fix-and-upsize). Wrong call: a bigger GPU with the " +
		"same config (upsize-only), or the same job again (resubmit). investigate: reading logs first.",
	"after-stale-api":
		"The decision is what the agent does after an error that suggests a library API changed (unexpected " +
		"keyword argument, cannot import name, missing attribute). Right call: check the real API first (docs, " +
		"source, printing a signature or version) (lookup). Wrong call: edit or rerun without checking " +
		"(blind-fix, blind-fix-and-resubmit, resubmit). If the error is in the agent's own code rather than a " +
		"library, the trigger is not a stale API.",
};

interface Annotation {
	model: string;
	at: string;
	/** two or three sentences: what the agent faced, what it did, how it turned out */
	summary: string;
	label: string;
	pass: boolean | null;
	/** one or two sentences on why that label, against the family's rule */
	rationale: string;
	/** false when the trigger is not what the family is about, e.g. a summary saying "not an OOM" */
	triggerValid: boolean;
	confidence: "low" | "medium" | "high";
}

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

function token(): string {
	if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
	const path = join(homedir(), ".cache", "huggingface", "token");
	if (existsSync(path)) return readFileSync(path, "utf8").trim();
	throw new Error("set HF_TOKEN or log in with `hf auth login`");
}

async function readCases(dir: string, ids: Set<string> | undefined): Promise<DecisionCase[]> {
	const cases: DecisionCase[] = [];
	for (const family of Object.keys(LABELS)) {
		const path = join(dir, `${family}.jsonl`);
		if (!existsSync(path)) continue;
		for await (const line of createInterface({ input: createReadStream(path) })) {
			const id = line.match(/^\{"id":"([^"]+)"/)?.[1];
			if (id && (!ids || ids.has(id))) cases.push(JSON.parse(line) as DecisionCase);
		}
	}
	return cases;
}

function prompt(c: DecisionCase): string {
	const view = caseView(c);
	const action = c.observed.action;
	const rounds = view.rounds
		.slice(-2)
		.flatMap((r) =>
			r.calls.map(
				(call) => `- ${call.name} ${call.args.slice(0, 400)}\n  → ${call.result.slice(0, 600)}`
			)
		)
		.join("\n");
	const decision =
		action.kind === "final"
			? `It ended the turn with this text:\n${action.text.slice(0, 1500)}`
			: [
					action.reasoning ? `Its reasoning:\n${action.reasoning.slice(0, 1500)}` : "",
					`Its calls${action.rounds && action.rounds > 1 ? ` (over ${action.rounds} rounds)` : ""}:`,
					...action.calls.map(
						(call) => `- ${call.name} ${JSON.stringify(call.args).slice(0, 1200)}`
					),
				]
					.filter(Boolean)
					.join("\n");
	const after = view.aftermath
		.map((a) => `- ${a.name} ${a.args.slice(0, 200)}\n  → ${a.result.slice(0, 500)}`)
		.join("\n");
	return [
		"You are checking one decision made by ML Intern, an agent that runs ML work on Hugging Face Jobs and sandboxes.",
		`Family: ${c.family}. ${RULES[c.family]}`,
		`Labels you may give: ${Object.keys(LABELS[c.family]).join(", ")}.`,
		`Facts the miner worked out: ${JSON.stringify(c.context)}`,
		`The user's task:\n${view.firstUser.slice(0, 1500)}`,
		c.trigger ? `What the agent was reacting to (${c.trigger.tool}):\n${c.trigger.excerpt}` : "",
		rounds ? `The rounds just before:\n${rounds}` : "",
		`The decision. ${decision}`,
		after ? `What happened next:\n${after}` : "What happened next: nothing recorded.",
		'Answer with JSON only: {"summary": "2-3 plain sentences: what it faced, what it did, how it turned out", ' +
			'"label": "<one label from the list>", "rationale": "1-2 sentences on why, against the rule", ' +
			'"triggerValid": true|false, "confidence": "low"|"medium"|"high"}',
	]
		.filter(Boolean)
		.join("\n\n");
}

async function annotate(c: DecisionCase, model: string, key: string): Promise<Annotation> {
	const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
		method: "POST",
		headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: prompt(c) }],
			max_tokens: 8000,
			temperature: 0.2,
		}),
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	const body = (await res.json()) as { choices: Array<{ message: { content?: string } }> };
	const text = body.choices[0]?.message.content ?? "";
	const json = text.match(/\{[\s\S]*\}/)?.[0];
	if (!json) throw new Error(`no JSON in answer: ${text.slice(0, 200)}`);
	const parsed = JSON.parse(json) as Omit<Annotation, "model" | "at" | "pass">;
	const labels = LABELS[c.family];
	if (!(parsed.label in labels)) throw new Error(`unknown label ${parsed.label}`);
	return { ...parsed, pass: labels[parsed.label], model, at: new Date().toISOString() };
}

async function main() {
	const dir = arg("--cases");
	if (!dir) throw new Error("usage: --cases <dir> [--all] [--force] [--model <id:provider>]");
	const model = arg("--model") ?? DEFAULT_MODEL;
	const path = join(dir, "review", "annotations.json");
	const done: Record<string, Annotation> = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: {};
	const sample = JSON.parse(readFileSync(join(dir, "review", "sample.json"), "utf8")) as Record<
		string,
		string[]
	>;
	const ids = process.argv.includes("--all") ? undefined : new Set(Object.values(sample).flat());
	const force = process.argv.includes("--force");
	const todo = (await readCases(dir, ids)).filter((c) => force || done[c.id]?.model !== model);
	console.error(`${todo.length} cases to annotate with ${model}`);

	const key = token();
	const save = () => {
		writeFileSync(`${path}.tmp`, `${JSON.stringify(done, null, 2)}\n`);
		renameSync(`${path}.tmp`, path);
	};
	let next = 0;
	let failed = 0;
	await Promise.all(
		Array.from({ length: CONCURRENCY }, async () => {
			while (next < todo.length) {
				const c = todo[next++];
				try {
					done[c.id] = await annotate(c, model, key);
					save();
					console.error(`${c.id} → ${done[c.id].label}`);
				} catch (error) {
					failed += 1;
					console.error(`${c.id} failed: ${error instanceof Error ? error.message : error}`);
				}
			}
		})
	);
	console.error(`done, ${failed} failed`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
