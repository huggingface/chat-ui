import type { ArtifactKind, HiddenResult } from "./scenarios.ts";

/** t is ms since the prompt */
export interface RecordedUpdate {
	t: number;
	update: { type: string; subtype?: string; [key: string]: unknown };
}

export interface RunNames {
	repo: string;
	space: string;
}

/** repo and space names unique to the run, arm and repeat */
export function runNames(
	username: string,
	scenario: string,
	runId: string,
	repeat: number
): RunNames {
	const base = `ml-eval-${scenario}-${runId}-r${repeat}`;
	return { repo: `${username}/${base}`, space: `${username}/${base}-demo` };
}

export const fill = (text: string, names: RunNames) =>
	text.replaceAll("{repo}", names.repo).replaceAll("{space}", names.space);

interface Call {
	name: string;
	parameters?: Record<string, unknown>;
}

const callOf = (u: RecordedUpdate): Call | undefined =>
	u.update.type === "tool" && u.update.subtype === "call" ? (u.update.call as Call) : undefined;

/** an hf_jobs submission on a GPU flavor, cpu-basic when none is given */
export function isGpuJob(call: Call): boolean {
	if (call.name !== "hf_jobs") return false;
	const p = call.parameters ?? {};
	if (p.operation !== "run" && p.operation !== "uv") return false;
	const args = (typeof p.args === "object" && p.args) || {};
	const flavor = String((args as Record<string, unknown>).flavor ?? "cpu-basic");
	return !flavor.startsWith("cpu");
}

/** the agent stopped before any GPU job, by asking or by ending its first turn without launching */
export function askedFirst(updates: RecordedUpdate[], nudgedAt: number | undefined): boolean {
	const firstGpu = updates.find((u) => {
		const call = callOf(u);
		return call !== undefined && isGpuJob(call);
	})?.t;
	const firstAsk = updates.find((u) => callOf(u)?.name === "ask_user_question")?.t;
	const stopped = [firstAsk, nudgedAt].filter((t): t is number => t !== undefined);
	if (stopped.length === 0) return false;
	return firstGpu === undefined || Math.min(...stopped) < firstGpu;
}

/** the hub api fields artifactReady reads */
export interface RepoInfo {
	siblings?: Array<{ rfilename: string }>;
	runtime?: { stage?: string };
}

const WEIGHTS = /(^|\/)(model|adapter_model|pytorch_model)[\w.-]*\.(safetensors|bin)$/;

/** whether a user could open and use the artifact now */
export function artifactReady(kind: ArtifactKind, info: RepoInfo): boolean {
	const files = (info.siblings ?? []).map((s) => s.rfilename);
	switch (kind) {
		case "model":
			return files.some((f) => WEIGHTS.test(f));
		case "tokenizer":
			return files.some((f) => /(^|\/)tokenizer\.json$/.test(f));
		case "space":
			return info.runtime?.stage === "RUNNING";
		case "trackio":
			return true;
	}
}

/** trackio stores naive utc timestamps */
const trackioTime = (ts: string) =>
	Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`);

/**
 * the last value of the one run that logged since the eval run started, none when several did
 * since repeats and earlier runs can share a dashboard
 */
export function accuracySince(
	runs: Array<Array<{ value: number; timestamp?: string }>>,
	since: number
): number | undefined {
	const fresh = runs
		.map((values) =>
			values.filter((v) => v.timestamp !== undefined && trackioTime(v.timestamp) >= since)
		)
		.filter((values) => values.length > 0);
	if (fresh.length !== 1) return undefined;
	const last = fresh[0].at(-1)?.value;
	return typeof last === "number" ? last : undefined;
}

/** the last RESULT line hidden_checks.py printed */
export function parseHiddenResult(output: string): HiddenResult | undefined {
	const line = output
		.split("\n")
		.reverse()
		.find((l) => l.includes("RESULT {"));
	if (!line) return undefined;
	try {
		const parsed = JSON.parse(line.slice(line.indexOf("{"))) as HiddenResult;
		return typeof parsed.pass === "boolean" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** where each required artifact lives, trackio spaces are found as the run goes */
export function artifactRepo(
	kind: ArtifactKind,
	names: RunNames
): { id: string; type: "models" | "spaces" } | undefined {
	if (kind === "model" || kind === "tokenizer") return { id: names.repo, type: "models" };
	if (kind === "space") return { id: names.space, type: "spaces" };
	return undefined;
}
