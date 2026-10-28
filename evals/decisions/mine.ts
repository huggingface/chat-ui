/**
 * Mines decision cases from the daily ML Intern conversation exports.
 *
 * Each case is a real conversation cut just before the agent made a decision of one family
 * (first GPU job, the turn after a failed job, after an out-of-memory error, after a stale-API error),
 * with what production did there and how the family's scorer labels it.
 *
 * Run: npm run eval:mine -- --exports <dir of conversations-*.ndjson.gz> --out <dir> [--seeds <file>]
 * --seeds maps conversation ids to the feedback that reported them, {"<id>": {"by", "link", "note"}}.
 * Writes <out>/<family>.jsonl and <out>/summary.json. The cases hold real users' conversations:
 * keep --out outside the repo, they go to the private dataset, never into git.
 */
import {
	appendFileSync,
	createReadStream,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { Message } from "$lib/types/Message";
import {
	MessageToolUpdateType,
	MessageUpdateType,
	type MessageToolCallUpdate,
	type MessageUpdate,
} from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { toolRounds } from "$lib/utils/messageShape";
import { isGpu, isJobSubmit, isSandboxWork, jobFlavor, label } from "./labels";
import { redact } from "./redact";
import type { Action, ActionCall, DecisionCase, Family, Feedback } from "./types";

const FAMILIES: Family[] = ["first-gpu-job", "after-job-failure", "after-oom", "after-stale-api"];
const MAX_PER_CONVERSATION = 3;
/** a conversation someone reported is the one the evals answer to, so more of it is kept */
const MAX_PER_SEED_CONVERSATION = 10;
const MAX_STORED_ARG_CHARS = 4000;

/** tools whose output is a program's own output, so an error in it is the agent's code failing */
const RUN_TOOLS = new Set(["check_job", "hf_jobs", "hf_sandbox_exec", "sandbox_task", "wait"]);

const SIGNALS: Array<{ family: Family; pattern: RegExp }> = [
	{
		family: "after-oom",
		pattern: /[^\n]*(?:CUDA out of memory|OutOfMemoryError|CUDA error: out of memory)[^\n]*/,
	},
	{
		family: "after-stale-api",
		pattern:
			/[^\n]*(?:TypeError: [^\n]*unexpected keyword argument|ImportError: cannot import name|AttributeError: module '[^']+' has no attribute|AttributeError: '\w*(?:Config|Arguments|Trainer)' object has no attribute)[^\n]*/,
	},
];

interface ExportedConversation {
	_id: { $oid: string };
	model: string;
	preprompt?: string;
	mlAssistant?: boolean;
	messages: Message[];
}

function parseArgs(argv: string[]): { exports: string; out: string; seeds?: string } {
	const get = (flag: string) => {
		const at = argv.indexOf(flag);
		return at === -1 ? undefined : argv[at + 1];
	};
	const exports = get("--exports");
	const out = get("--out");
	if (!exports || !out) throw new Error("usage: --exports <dir> --out <dir> [--seeds <file>]");
	return { exports, out, seeds: get("--seeds") };
}

async function* lines(file: string): AsyncGenerator<string> {
	const input = createReadStream(file).pipe(createGunzip());
	yield* createInterface({ input, crlfDelay: Infinity });
}

/** exports are daily increments, so a conversation's newest copy is in the last file holding it */
async function newestFileById(files: string[]): Promise<Map<string, number>> {
	const newest = new Map<string, number>();
	for (const [index, file] of files.entries()) {
		for await (const line of lines(file)) {
			const id = line.match(/^\{"_id":\{"\$oid":"([0-9a-f]{24})"/)?.[1];
			if (id) newest.set(id, index);
		}
	}
	return newest;
}

function callArgs(update: MessageToolCallUpdate): Record<string, unknown> {
	if (update.argumentsRaw) {
		try {
			const parsed: unknown = JSON.parse(update.argumentsRaw);
			if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
		} catch {
			// a cut stream leaves argumentsRaw unparseable, the stored parameters are all there is
		}
	}
	return update.call.parameters;
}

function toActionCall(update: MessageToolCallUpdate): ActionCall {
	return { name: update.call.name, args: callArgs(update) };
}

function resultText(update: MessageUpdate): string | undefined {
	if (update.type !== MessageUpdateType.Tool) return undefined;
	if (update.subtype === MessageToolUpdateType.Error) return update.message;
	if (update.subtype !== MessageToolUpdateType.Result) return undefined;
	const result = update.result;
	if (result.status === ToolResultStatus.Error) return result.message;
	return result.outputs
		.map((output) => (typeof output.text === "string" ? output.text : ""))
		.join("\n");
}

function truncateArgs(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length > MAX_STORED_ARG_CHARS
			? `${value.slice(0, MAX_STORED_ARG_CHARS)}… [${value.length - MAX_STORED_ARG_CHARS} chars cut]`
			: value;
	}
	if (Array.isArray(value)) return value.map(truncateArgs);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateArgs(v)]));
	}
	return value;
}

function excerpt(text: string, match: RegExpMatchArray): string {
	const at = match.index ?? 0;
	return text.slice(Math.max(0, at - 800), at + match[0].length + 200);
}

interface Decision {
	family: Family;
	/** the round the decision is, rounds.length when the turn ended in text */
	round: number;
	/** updates kept before the cut */
	cutIndex: number;
	action: Action;
	trigger?: { tool: string; excerpt: string };
	context: DecisionCase["context"];
	dedupeKey: string;
}

/** what the path has done so far, carried from turn to turn */
interface History {
	gpuJobSeen: boolean;
	lastGpuFlavor?: string;
	sandboxUsed: boolean;
	/** file names sandbox calls mentioned, to tell whether a job's script was run in one first */
	sandboxFiles: Set<string>;
	failedJobs: Set<string>;
}

const FILE_NAME = /[\w.-]+\.(?:py|sh|ipynb|ya?ml|json|toml)\b/g;

function cloneHistory(history: History): History {
	return {
		...history,
		sandboxFiles: new Set(history.sandboxFiles),
		failedJobs: new Set(history.failedJobs),
	};
}

/** fixing and resubmitting is often an edit round then a submit round, so both are scored */
const JOB_FAILURE_SPAN = 3;

const FAILED_STATUS = /^[\s*-]*Status:?\**:?\s*\**failed\b/im;

function scriptName(call: ActionCall): string | undefined {
	const script = JSON.stringify(call.args).match(/v-file:\/\/([\w.-]+?)(?:@v\d+)?"/);
	return script?.[1];
}

/** walks one assistant turn, updating `history`, and returns the decisions in it when `emit` */
function walkTurn(message: Message, history: History, emit: boolean): Decision[] {
	const updates = message.updates ?? [];
	const rounds = toolRounds(updates);
	const decisions: Decision[] = [];
	const actionAt = (round: number): Action | undefined => {
		if (round < rounds.length) {
			const first = rounds[round].calls[0];
			return {
				kind: "calls",
				calls: rounds[round].calls.map(toActionCall),
				reasoning: first.reasoning,
				preamble: first.content,
			};
		}
		const text = message.content.trim();
		return text && !message.interrupted ? { kind: "final", text } : undefined;
	};
	const cutAt = (round: number): number => {
		if (round < rounds.length) return rounds[round].start;
		const lastOutcome = updates.findLastIndex((u) => resultText(u) !== undefined);
		return lastOutcome + 1;
	};
	/** the rounds from `round` until one sandboxes or submits a job, at most `span` of them */
	const actionUntilDecisive = (round: number, span: number): Action | undefined => {
		const first = actionAt(round);
		if (first?.kind !== "calls") return first;
		const calls = [...first.calls];
		let spanned = 1;
		const decisive = (list: ActionCall[]) => list.some((c) => isSandboxWork(c) || isJobSubmit(c));
		while (!decisive(calls) && spanned < span && round + spanned < rounds.length) {
			calls.push(...rounds[round + spanned].calls.map(toActionCall));
			spanned += 1;
		}
		return { ...first, calls, rounds: spanned };
	};
	const push = (
		decision: Omit<Decision, "round" | "cutIndex" | "action">,
		round: number,
		span = 1
	) => {
		const action = emit ? actionUntilDecisive(round, span) : undefined;
		if (action) decisions.push({ ...decision, round, cutIndex: cutAt(round), action });
	};

	const calls = new Map<string, ActionCall>();
	for (const [index, update] of updates.entries()) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Call) {
			const call = toActionCall(update);
			calls.set(update.uuid, call);
			if (isSandboxWork(call)) {
				history.sandboxUsed = true;
				for (const name of JSON.stringify(call.args).match(FILE_NAME) ?? []) {
					history.sandboxFiles.add(name);
				}
			}
			if (isJobSubmit(call) && isGpu(jobFlavor(call))) {
				if (!history.gpuJobSeen) {
					const script = scriptName(call);
					push(
						{
							family: "first-gpu-job",
							context: {
								sandboxUsed: history.sandboxUsed,
								script,
								sandboxedScript: script ? history.sandboxFiles.has(script) : undefined,
							},
							dedupeKey: `first-gpu-job/${update.uuid}`,
						},
						rounds.findIndex((r) => r.calls.includes(update))
					);
				}
				history.gpuJobSeen = true;
				history.lastGpuFlavor = jobFlavor(call);
			}
			continue;
		}
		const call = calls.get(update.uuid);
		const text = resultText(update);
		if (!call || !RUN_TOOLS.has(call.name) || text === undefined) continue;
		const nextRound = rounds.findIndex((r) => r.start > index);
		const next = nextRound === -1 ? rounds.length : nextRound;
		let signalled = false;
		for (const { family, pattern } of SIGNALS) {
			const match = text.match(pattern);
			if (!match) continue;
			signalled = true;
			push(
				{
					family,
					trigger: { tool: call.name, excerpt: excerpt(text, match) },
					context: { failedFlavor: family === "after-oom" ? history.lastGpuFlavor : undefined },
					// the same error read again by a later check is the same event
					dedupeKey: `${family}/${match[0].replace(/\d+(\.\d+)?/g, "#").trim()}`,
				},
				next
			);
		}
		// check_job's diagnosis, not the wait wake-up, is what the agent decides from
		const jobId = typeof call.args.job_id === "string" ? call.args.job_id : undefined;
		const failed = call.name === "check_job" && FAILED_STATUS.exec(text);
		if (!failed || !jobId || /timeout/i.test(text.slice(0, 300))) continue;
		const firstFailure = !history.failedJobs.has(jobId);
		history.failedJobs.add(jobId);
		if (signalled || !firstFailure) continue;
		push(
			{
				family: "after-job-failure",
				trigger: { tool: call.name, excerpt: text.slice(0, 1200) },
				context: { failedJobsSoFar: history.failedJobs.size },
				dedupeKey: `after-job-failure/${jobId}`,
			},
			next,
			JOB_FAILURE_SPAN
		);
	}
	return decisions;
}

function casesFor(
	conversation: ExportedConversation,
	exportFile: string,
	feedback?: Feedback
): DecisionCase[] {
	const byId = new Map(conversation.messages.map((m) => [m.id, m]));
	const conversationId = conversation._id.$oid;
	const seen = new Set<string>();
	const perFamily = new Map<Family, number>();
	const cases: DecisionCase[] = [];

	// each turn is walked once, its history handed down to the turns after it on any branch
	const after = new Map<string, History>();
	const historyBefore = (message: Message): History => {
		const parentId = [...(message.ancestors ?? [])]
			.reverse()
			.find((id) => byId.get(id)?.from === "assistant");
		const parent = parentId ? byId.get(parentId) : undefined;
		if (!parent)
			return {
				gpuJobSeen: false,
				sandboxUsed: false,
				sandboxFiles: new Set(),
				failedJobs: new Set(),
			};
		let history = after.get(parent.id);
		if (!history) {
			history = historyBefore(parent);
			walkTurn(parent, history, false);
			after.set(parent.id, history);
		}
		return cloneHistory(history);
	};

	for (const target of conversation.messages) {
		if (target.from !== "assistant") continue;
		const path = [...(target.ancestors ?? []), target.id].map((id) => byId.get(id));
		if (path.some((m) => !m)) continue;
		const history = historyBefore(target);
		const decisions = walkTurn(target, history, true);
		after.set(target.id, history);

		for (const decision of decisions) {
			if (seen.has(decision.dedupeKey)) continue;
			seen.add(decision.dedupeKey);
			const count = perFamily.get(decision.family) ?? 0;
			if (count >= (feedback ? MAX_PER_SEED_CONVERSATION : MAX_PER_CONVERSATION)) continue;
			perFamily.set(decision.family, count + 1);

			const observed = label(decision.family, decision.action, decision.context);
			const cut: Message = {
				...target,
				content: "",
				reasoning: undefined,
				children: [],
				updates: (target.updates ?? []).slice(0, decision.cutIndex),
			};
			cases.push({
				id: `${decision.family}/${conversationId}/${target.id}/r${decision.round}`,
				family: decision.family,
				source: {
					conversationId,
					messageId: target.id,
					round: decision.round,
					exportFile,
					harness: target.harness,
					feedback,
				},
				model: {
					id: target.harness?.model ?? conversation.model,
					provider: target.harness?.provider,
				},
				trigger: decision.trigger,
				context: decision.context,
				observed: {
					action:
						decision.action.kind === "calls"
							? {
									...decision.action,
									calls: decision.action.calls.map((c) => ({
										name: c.name,
										args: truncateArgs(c.args) as Record<string, unknown>,
									})),
								}
							: decision.action,
					...observed,
				},
				conversation: {
					model: conversation.model,
					preprompt: conversation.preprompt,
					mlAssistant: conversation.mlAssistant,
					messages: [...(path as Message[]).slice(0, -1), cut],
				},
			});
		}
	}
	return cases;
}

async function main() {
	const { exports, out, seeds } = parseArgs(process.argv.slice(2));
	const feedbackById: Record<string, Feedback> = seeds
		? JSON.parse(readFileSync(seeds, "utf8"))
		: {};
	const names = readdirSync(exports)
		.filter((name) => /^conversations-.*\.ndjson\.gz$/.test(name))
		.sort();
	const files = names.map((name) => join(exports, name));
	const newest = await newestFileById(files);
	console.error(`${newest.size} conversations across ${files.length} exports`);

	mkdirSync(out, { recursive: true });
	for (const family of FAMILIES) writeFileSync(join(out, `${family}.jsonl`), "");
	// cases carry whole conversations, so only what the summary needs stays in memory
	const kept: Array<{
		family: Family;
		conversationId: string;
		model: string;
		label: string;
		pass: boolean | null;
	}> = [];
	let scanned = 0;
	for (const [index, file] of files.entries()) {
		for await (const line of lines(file)) {
			const id = line.match(/^\{"_id":\{"\$oid":"([0-9a-f]{24})"/)?.[1];
			if (!id || newest.get(id) !== index) continue;
			const conversation = JSON.parse(line) as ExportedConversation;
			if (!conversation.mlAssistant) continue;
			scanned += 1;
			for (const c of casesFor(conversation, names[index], feedbackById[id])) {
				appendFileSync(join(out, `${c.family}.jsonl`), `${redact(JSON.stringify(c))}\n`);
				kept.push({
					family: c.family,
					conversationId: c.source.conversationId,
					model: `${c.model.id}${c.model.provider ? `@${c.model.provider}` : ""}`,
					label: c.observed.label,
					pass: c.observed.pass,
				});
			}
		}
	}

	const summary: Record<string, unknown> = { scannedConversations: scanned };
	for (const family of FAMILIES) {
		const cases = kept.filter((c) => c.family === family);
		const tally = (key: "model" | "label") => {
			const counts = new Map<string, number>();
			for (const c of cases) counts.set(c[key], (counts.get(c[key]) ?? 0) + 1);
			return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
		};
		const judged = cases.filter((c) => c.pass !== null);
		summary[family] = {
			cases: cases.length,
			conversations: new Set(cases.map((c) => c.conversationId)).size,
			productionLabels: tally("label"),
			productionPassRate: judged.length
				? Number((judged.filter((c) => c.pass).length / judged.length).toFixed(3))
				: null,
			models: tally("model"),
		};
	}
	writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
