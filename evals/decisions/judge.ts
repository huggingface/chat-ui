/**
 * A model reading one decision and labelling it against its family's rule. Used to label the
 * mined cases (annotate.ts) and to score eval samples (compare.ts), so both read decisions the
 * same way.
 *
 * Cases are real users' conversations: the judge's provider sees them, so pick one that already
 * serves ML Intern in production.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { caseView } from "./digest";
import { LABELS } from "./labels";
import type { Action, DecisionCase, Family } from "./types";

export const DEFAULT_JUDGE = "deepseek-ai/DeepSeek-V4.1-Flash-1017:novita";
export const JUDGE_TEMPERATURE = 0.2;
export const ATTEMPTS = 3;

/** what each family asks and what its labels mean, the same rules labels.ts applies */
export const RULES: Record<Family, string> = {
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

/** the tools a judge confused: editing the stored script is not developing in a sandbox */
const TOOLS =
	"Tools: hf_sandbox, hf_sandbox_exec, hf_sandbox_fs and sandbox_task run code in a sandbox; hf_jobs runs a " +
	"job; check_job and wait read a job. write_file, edit_file and read_file only write, change or read the " +
	"agent's stored script (v-file://); they run nothing, in a sandbox or anywhere else.";

export interface Judgement {
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

export function hfToken(): string {
	if (process.env.HF_TOKEN) return process.env.HF_TOKEN;
	const path = join(homedir(), ".cache", "huggingface", "token");
	if (existsSync(path)) return readFileSync(path, "utf8").trim();
	throw new Error("set HF_TOKEN or log in with `hf auth login`");
}

/**
 * `action` replaces what the agent did, to judge a re-sampled step. A sample has no recorded
 * aftermath, and its scripts are the case's own, so only its calls are new.
 */
function prompt(c: DecisionCase, action: Action, sampled: boolean): string {
	const view = caseView(c);
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
	const next = sampled
		? "What happened next: this is the agent's next step only; nothing after it ran. Judge the step " +
			"itself. When it has not committed to a choice yet (reading, editing the script, planning), use " +
			"investigate where the family has it, otherwise other."
		: after
			? `What happened next:\n${after}`
			: "What happened next: nothing recorded.";
	return [
		"You are checking one decision made by ML Intern, an agent that runs ML work on Hugging Face Jobs and sandboxes.",
		`Family: ${c.family}. ${RULES[c.family]}`,
		TOOLS,
		`Labels you may give: ${Object.keys(LABELS[c.family]).join(", ")}.`,
		`Facts the miner worked out: ${JSON.stringify(c.context)}`,
		`The user's task:\n${view.firstUser.slice(0, 1500)}`,
		c.trigger ? `What the agent was reacting to (${c.trigger.tool}):\n${c.trigger.excerpt}` : "",
		rounds ? `The rounds just before:\n${rounds}` : "",
		`The decision. ${decision}`,
		next,
		'Answer with JSON only: {"summary": "2-3 plain sentences: what it faced, what it did, how it turned out", ' +
			'"label": "<one label from the list>", "rationale": "1-2 sentences on why, against the rule", ' +
			'"triggerValid": true|false, "confidence": "low"|"medium"|"high"}',
	]
		.filter(Boolean)
		.join("\n\n");
}

/** one judgement, retried on transport errors and on answers that are not a known label */
export async function judge(
	c: DecisionCase,
	{ model, key, action }: { model: string; key: string; action?: Action }
): Promise<Judgement> {
	const text = prompt(c, action ?? c.observed.action, action !== undefined);
	let lastError: unknown;
	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		try {
			return await judgeOnce(c.family, text, model, key);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

async function judgeOnce(
	family: Family,
	text: string,
	model: string,
	key: string
): Promise<Judgement> {
	const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
		method: "POST",
		headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: text }],
			max_tokens: 8000,
			temperature: JUDGE_TEMPERATURE,
		}),
	});
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	const body = (await res.json()) as { choices: Array<{ message: { content?: string } }> };
	const answer = body.choices[0]?.message.content ?? "";
	const json = answer.match(/\{[\s\S]*\}/)?.[0];
	if (!json) throw new Error(`no JSON in answer: ${answer.slice(0, 200)}`);
	const parsed = JSON.parse(json) as Omit<Judgement, "model" | "at" | "pass">;
	const labels = LABELS[family];
	if (!(parsed.label in labels)) throw new Error(`unknown label ${parsed.label}`);
	return { ...parsed, pass: labels[parsed.label], model, at: new Date().toISOString() };
}
