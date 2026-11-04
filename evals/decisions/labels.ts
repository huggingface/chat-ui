import type { Action, ActionCall, DecisionCase, Family } from "./types";

/**
 * Labels the action taken at a decision, for production's stored turn and for sampled completions
 * alike, so the baseline and an eval run are scored by the same rules. `pass` is null for a label
 * the family does not judge.
 */
export function label(
	family: Family,
	action: Action,
	context: DecisionCase["context"] = {}
): { label: string; pass: boolean | null } {
	if (action.kind === "final") return { label: "ended-turn", pass: null };
	const calls = action.calls;
	if (calls.some((c) => c.name === "ask_user_question")) return { label: "asked-user", pass: null };
	switch (family) {
		case "first-gpu-job":
			return labelFirstGpuJob(calls, context);
		case "after-job-failure":
			return labelAfterJobFailure(calls, context);
		case "after-oom":
			return labelAfterOom(calls, context.failedFlavor);
		case "after-stale-api":
			return labelAfterStaleApi(calls);
	}
}

const SHARED = { "ended-turn": null, "asked-user": null, other: null };

/** every label a family can give and its verdict, for a reviewer correcting one by hand */
export const LABELS: Record<Family, Record<string, boolean | null>> = {
	"first-gpu-job": {
		"develop-in-sandbox": true,
		"job-after-sandboxing-script": true,
		"job-after-other-sandbox-work": null,
		"job-without-sandbox": false,
		...SHARED,
	},
	"after-job-failure": {
		"reproduce-in-sandbox": true,
		"fix-and-resubmit": false,
		resubmit: false,
		"fix-only": null,
		"different-job": null,
		investigate: null,
		...SHARED,
	},
	"after-oom": {
		"fix-memory": true,
		"fix-and-upsize": true,
		"upsize-only": false,
		resubmit: false,
		investigate: null,
		...SHARED,
	},
	"after-stale-api": {
		lookup: true,
		"blind-fix": false,
		"blind-fix-and-resubmit": false,
		resubmit: false,
		...SHARED,
	},
};

/**
 * The ask from user feedback (2026-10-24): develop in a sandbox before submitting jobs. A job whose script
 * a sandbox call named earlier passes; sandbox work on something else is left to a reviewer.
 */
function labelFirstGpuJob(
	calls: ActionCall[],
	context: DecisionCase["context"]
): { label: string; pass: boolean | null } {
	if (calls.some(isSandboxWork)) return { label: "develop-in-sandbox", pass: true };
	if (!calls.some(isJobSubmit)) return { label: "other", pass: null };
	if (context.sandboxedScript) return { label: "job-after-sandboxing-script", pass: true };
	if (context.sandboxUsed) return { label: "job-after-other-sandbox-work", pass: null };
	return { label: "job-without-sandbox", pass: false };
}

function labelAfterJobFailure(
	calls: ActionCall[],
	context: DecisionCase["context"]
): { label: string; pass: boolean | null } {
	if (calls.some(isSandboxWork)) return { label: "reproduce-in-sandbox", pass: true };
	const job = calls.find(isJobSubmit);
	if (job && context.failedScript && scriptName(job) && scriptName(job) !== context.failedScript) {
		return { label: "different-job", pass: null };
	}
	if (job) {
		return calls.some(isEdit)
			? { label: "fix-and-resubmit", pass: false }
			: { label: "resubmit", pass: false };
	}
	if (calls.some(isEdit)) return { label: "fix-only", pass: null };
	if (calls.some((c) => isLookup(c) || INSPECT_TOOLS.has(c.name))) {
		return { label: "investigate", pass: null };
	}
	return { label: "other", pass: null };
}

const INSPECT_TOOLS = new Set(["check_job", "hf_jobs", "read_file", "hf_fs"]);

function labelAfterOom(
	calls: ActionCall[],
	failedFlavor: string | undefined
): { label: string; pass: boolean | null } {
	const memoryFix = calls.some((c) => isEdit(c) && MEMORY_KNOBS.test(JSON.stringify(c.args)));
	const job = calls.find(isJobSubmit);
	if (job) {
		const bigger =
			failedFlavor !== undefined && gpuMemoryGb(jobFlavor(job)) > gpuMemoryGb(failedFlavor);
		if (memoryFix || MEMORY_KNOBS.test(JSON.stringify(job.args))) {
			return { label: bigger ? "fix-and-upsize" : "fix-memory", pass: true };
		}
		return bigger ? { label: "upsize-only", pass: false } : { label: "resubmit", pass: false };
	}
	if (memoryFix) return { label: "fix-memory", pass: true };
	if (calls.some(isLookup)) return { label: "investigate", pass: null };
	return { label: "other", pass: null };
}

function labelAfterStaleApi(calls: ActionCall[]): { label: string; pass: boolean | null } {
	if (calls.some(isLookup)) return { label: "lookup", pass: true };
	if (calls.some(isRerun)) {
		return calls.some(isEdit)
			? { label: "blind-fix-and-resubmit", pass: false }
			: { label: "resubmit", pass: false };
	}
	if (calls.some(isEdit)) return { label: "blind-fix", pass: false };
	return { label: "other", pass: null };
}

const MEMORY_KNOBS =
	/batch_size|gradient_accumulation|gradient_checkpointing|max_length|max_seq_length|max_seq_len|load_in_4bit|load_in_8bit|BitsAndBytes|PYTORCH_CUDA_ALLOC_CONF|expandable_segments|torch_dtype|bf16|fp16|lora|offload|deepspeed|fsdp|empty_cache|gc\.collect|\bdel\s|no_grad|inference_mode|device_map|max_memory|low_cpu_mem_usage/i;

const LOOKUP_TOOLS = new Set([
	"github_read_file",
	"github_find_examples",
	"research",
	"web_search_exa",
	"crawling_exa",
	"get_code_context_exa",
	"hub_repo_details",
]);

/** a docs read, a source read, or printing a signature or version in a sandbox */
function isLookup(c: ActionCall): boolean {
	if (LOOKUP_TOOLS.has(c.name)) return true;
	const text = JSON.stringify(c.args);
	if (c.name === "hf_fs") return /hf:\/\/docs|site-packages|\.py\b/.test(text);
	if (c.name.startsWith("hf_sandbox") || c.name === "sandbox_task") {
		return /inspect\.signature|help\(|__version__|pip show|pip index|dir\(|site-packages|grep /.test(
			text
		);
	}
	return false;
}

/** sandbox scripts get patched in place as often as through the file tools */
function isEdit(c: ActionCall): boolean {
	if (c.name === "edit_file" || c.name === "write_file" || c.name === "hf_fs_write") return true;
	const text = JSON.stringify(c.args);
	if (c.name === "hf_sandbox_fs") return /"(write|edit)"/.test(text);
	if (c.name === "hf_sandbox_exec") return /sed -i|cat >|tee |> ?\S+\.py/.test(text);
	return false;
}

/** using a sandbox to run or write code, not managing one */
export function isSandboxWork(c: ActionCall): boolean {
	if (c.name === "sandbox_task" || c.name === "hf_sandbox_exec" || c.name === "hf_sandbox_fs")
		return true;
	return c.name === "hf_sandbox" && sandboxCommand(c) === "create";
}

/** running the script again in a sandbox is the same move as resubmitting the job */
function isRerun(c: ActionCall): boolean {
	return (
		isJobSubmit(c) ||
		(c.name === "hf_sandbox_exec" &&
			/python3? |bash |uv run|accelerate launch|torchrun/.test(JSON.stringify(c.args)))
	);
}

export function scriptName(call: ActionCall): string | undefined {
	return JSON.stringify(call.args).match(/v-file:\/\/([\w.-]+?)(?:@v\d+)?"/)?.[1];
}

export function isJobSubmit(c: ActionCall): boolean {
	if (c.name !== "hf_jobs") return false;
	const op = c.args.operation ?? nested(c).operation;
	return op === "uv" || op === "run";
}

export function jobFlavor(c: ActionCall): string | undefined {
	return stringArg(nested(c).flavor ?? c.args.flavor);
}

export function isGpu(flavor: string | undefined): boolean {
	return gpuMemoryGb(flavor) > 0;
}

const GPU_MEMORY_GB: Record<string, number> = {
	t4: 16,
	l4: 24,
	a10g: 24,
	l40s: 48,
	a100: 80,
	h100: 80,
	h200: 141,
};

/** total GPU memory of a Jobs flavor, 0 for CPU, so flavors compare by what can fit */
export function gpuMemoryGb(flavor: string | undefined): number {
	const match = flavor?.toLowerCase().match(/^(t4|l4|a10g|l40s|a100|h100|h200)/);
	if (!match) return 0;
	const count = Number(flavor?.match(/x(\d+)$/)?.[1] ?? 1);
	return GPU_MEMORY_GB[match[1]] * count;
}

function nested(c: ActionCall): Record<string, unknown> {
	const args = c.args.args;
	return args && typeof args === "object" && !Array.isArray(args)
		? (args as Record<string, unknown>)
		: {};
}

function sandboxCommand(c: ActionCall): string | undefined {
	return (
		stringArg(c.args.cmd) ?? (Array.isArray(c.args.args) ? stringArg(c.args.args[0]) : undefined)
	);
}

function stringArg(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
