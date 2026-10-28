/**
 * Mines decision cases from the daily ML Intern conversation exports.
 *
 * Each case is a real conversation cut just before the agent made a decision of one family
 * (first GPU job, the turn after an out-of-memory error, the turn after a stale-API error),
 * with what production did there and how the family's scorer labels it.
 *
 * Run: npm run eval:mine -- --exports <dir of conversations-*.ndjson.gz> --out <dir>
 * Writes <out>/<family>.jsonl and <out>/summary.json. The cases hold real users' conversations:
 * keep --out outside the repo, they go to the private dataset, never into git.
 */
import { appendFileSync, createReadStream, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
import { isGpu, isJobSubmit, jobFlavor, label } from "./labels";
import { redact } from "./redact";
import type { Action, ActionCall, DecisionCase, Family } from "./types";

const FAMILIES: Family[] = ["first-gpu-job", "after-oom", "after-stale-api"];
const MAX_PER_CONVERSATION = 3;
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

function parseArgs(argv: string[]): { exports: string; out: string } {
	const get = (flag: string) => {
		const at = argv.indexOf(flag);
		if (at === -1 || !argv[at + 1]) throw new Error(`missing ${flag}`);
		return argv[at + 1];
	};
	return { exports: get("--exports"), out: get("--out") };
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
	failedFlavor?: string;
	dedupeKey: string;
}

/** decisions inside one assistant turn; `gpuJobBefore` says whether an earlier turn on its path ran one */
function findDecisions(
	message: Message,
	gpuJobBefore: boolean,
	lastGpuFlavor?: string
): Decision[] {
	const updates = message.updates ?? [];
	const rounds = toolRounds(updates);
	const decisions: Decision[] = [];
	const actionAt = (round: number): Action | undefined => {
		if (round < rounds.length)
			return { kind: "calls", calls: rounds[round].calls.map(toActionCall) };
		const text = message.content.trim();
		return text && !message.interrupted ? { kind: "final", text } : undefined;
	};
	const cutAt = (round: number): number => {
		if (round < rounds.length) return rounds[round].start;
		const lastOutcome = updates.findLastIndex((u) => resultText(u) !== undefined);
		return lastOutcome + 1;
	};

	let flavor = lastGpuFlavor;
	let sawGpuJob = gpuJobBefore;
	const names = new Map<string, string>();
	for (const [index, update] of updates.entries()) {
		if (update.type !== MessageUpdateType.Tool) continue;
		if (update.subtype === MessageToolUpdateType.Call) {
			names.set(update.uuid, update.call.name);
			const call = toActionCall(update);
			if (isJobSubmit(call) && isGpu(jobFlavor(call))) {
				if (!sawGpuJob) {
					const round = rounds.findIndex((r) => r.calls.includes(update));
					const action = actionAt(round);
					if (action) {
						decisions.push({
							family: "first-gpu-job",
							round,
							cutIndex: cutAt(round),
							action,
							dedupeKey: `first-gpu-job/${update.uuid}`,
						});
					}
				}
				sawGpuJob = true;
				flavor = jobFlavor(call);
			}
			continue;
		}
		const tool = names.get(update.uuid);
		const text = resultText(update);
		if (!tool || !RUN_TOOLS.has(tool) || text === undefined) continue;
		for (const { family, pattern } of SIGNALS) {
			const match = text.match(pattern);
			if (!match) continue;
			const round = rounds.findIndex((r) => r.start > index);
			const next = round === -1 ? rounds.length : round;
			const action = actionAt(next);
			if (!action) continue;
			decisions.push({
				family,
				round: next,
				cutIndex: cutAt(next),
				action,
				trigger: { tool, excerpt: excerpt(text, match) },
				failedFlavor: family === "after-oom" ? flavor : undefined,
				// the same error read again by a later check is the same event
				dedupeKey: `${family}/${match[0].replace(/\d+(\.\d+)?/g, "#").trim()}`,
			});
		}
	}
	return decisions;
}

function hasGpuJob(message: Message): string | undefined {
	let flavor: string | undefined;
	for (const update of message.updates ?? []) {
		if (update.type !== MessageUpdateType.Tool || update.subtype !== MessageToolUpdateType.Call) {
			continue;
		}
		const call = toActionCall(update);
		if (isJobSubmit(call) && isGpu(jobFlavor(call))) flavor = jobFlavor(call);
	}
	return flavor;
}

function casesFor(conversation: ExportedConversation, exportFile: string): DecisionCase[] {
	const byId = new Map(conversation.messages.map((m) => [m.id, m]));
	const conversationId = conversation._id.$oid;
	const seen = new Set<string>();
	const perFamily = new Map<Family, number>();
	const cases: DecisionCase[] = [];

	for (const target of conversation.messages) {
		if (target.from !== "assistant") continue;
		const path = [...(target.ancestors ?? []), target.id].map((id) => byId.get(id));
		if (path.some((m) => !m)) continue;
		const earlier = (path as Message[]).slice(0, -1).filter((m) => m.from === "assistant");
		const lastFlavor = earlier.map(hasGpuJob).filter(Boolean).at(-1);

		for (const decision of findDecisions(target, lastFlavor !== undefined, lastFlavor)) {
			if (seen.has(decision.dedupeKey)) continue;
			seen.add(decision.dedupeKey);
			const count = perFamily.get(decision.family) ?? 0;
			if (count >= MAX_PER_CONVERSATION) continue;
			perFamily.set(decision.family, count + 1);

			const observed = label(decision.family, decision.action, {
				failedFlavor: decision.failedFlavor,
			});
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
				},
				model: {
					id: target.harness?.model ?? conversation.model,
					provider: target.harness?.provider,
				},
				trigger: decision.trigger,
				context: { failedFlavor: decision.failedFlavor },
				observed: {
					action:
						decision.action.kind === "calls"
							? {
									kind: "calls",
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
	const { exports, out } = parseArgs(process.argv.slice(2));
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
			for (const c of casesFor(conversation, names[index])) {
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
