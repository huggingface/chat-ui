import type { Action, ActionCall, Family } from "./types";

/**
 * Labels the action taken at a decision, for production's stored turn and for sampled completions
 * alike, so the baseline and an eval run are scored by the same rules. `pass` is null for a label
 * the family does not judge.
 */
export function label(
	family: Family,
	action: Action,
	context: { failedFlavor?: string } = {}
): { label: string; pass: boolean | null } {
	if (action.kind === "final") return { label: "ended-turn", pass: null };
	const calls = action.calls;
	if (calls.some((c) => c.name === "ask_user_question")) return { label: "asked-user", pass: null };
	switch (family) {
		case "first-gpu-job":
			return labelFirstGpuJob(calls);
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
		"gpu-smoke-job": true,
		"gpu-sandbox": true,
		"gpu-full-job": false,
		"cpu-sandbox": null,
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

function labelFirstGpuJob(calls: ActionCall[]): { label: string; pass: boolean | null } {
	const job = calls.find((c) => isJobSubmit(c) && isGpu(jobFlavor(c)));
	if (job) {
		return looksLikeSmoke(job)
			? { label: "gpu-smoke-job", pass: true }
			: { label: "gpu-full-job", pass: false };
	}
	const sandbox = calls.find((c) => c.name === "hf_sandbox" && sandboxCommand(c) === "create");
	if (sandbox) {
		return isGpu(stringArg(flagValue(sandbox, "--flavor")))
			? { label: "gpu-sandbox", pass: true }
			: { label: "cpu-sandbox", pass: null };
	}
	return { label: "other", pass: null };
}

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

/** running the script again in a sandbox is the same move as resubmitting the job */
function isRerun(c: ActionCall): boolean {
	return (
		isJobSubmit(c) ||
		(c.name === "hf_sandbox_exec" &&
			/python3? |bash |uv run|accelerate launch|torchrun/.test(JSON.stringify(c.args)))
	);
}

export function isJobSubmit(c: ActionCall): boolean {
	if (c.name !== "hf_jobs") return false;
	const op = c.args.operation ?? nested(c).operation;
	return op === "uv" || op === "run";
}

export function jobFlavor(c: ActionCall): string | undefined {
	return stringArg(nested(c).flavor ?? c.args.flavor);
}

function looksLikeSmoke(c: ActionCall): boolean {
	return /smoke|sanity|debug|dry.?run|probe|max_steps|max-steps|--steps|SMOKE/i.test(
		JSON.stringify(c.args)
	);
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

function flagValue(c: ActionCall, flag: string): unknown {
	const args = Array.isArray(c.args.args) ? c.args.args : [];
	const at = args.indexOf(flag);
	return at === -1 ? c.args[flag.replace(/^--/, "")] : args[at + 1];
}

function stringArg(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
