import { describe, expect, it } from "vitest";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import type { Message } from "$lib/types/Message";
import { contextFor } from "./calls";
import { gpuMemoryGb, label as rawLabel, LABELS } from "./labels";
import type { Action, ActionCall, DecisionCase } from "./types";

/** every verdict a test sees must match the table a reviewer corrects from */
const label: typeof rawLabel = (family, action, context) => {
	const result = rawLabel(family, action, context);
	expect(LABELS[family][result.label]).toBe(result.pass);
	return result;
};

const job = (args: Record<string, unknown>): ActionCall => ({
	name: "hf_jobs",
	args: { operation: "uv", args: { operation: "uv", script: "v-file://train.py", ...args } },
});
const edit = (text: string): ActionCall => ({
	name: "edit_file",
	args: { path: "v-file://train.py", old_str: "x", new_str: text },
});
const calls = (...list: ActionCall[]) => ({ kind: "calls" as const, calls: list });

/** a stored sandbox call naming a script, the shape the miner collects sandboxed file names from */
const sandboxCall = (script: string): Message => ({
	id: "0b6d5f8e-0000-4000-8000-000000000001",
	from: "assistant",
	content: "",
	updates: [
		{
			type: MessageUpdateType.Tool,
			subtype: MessageToolUpdateType.Call,
			uuid: "0b6d5f8e-0000-4000-8000-000000000002",
			call: { name: "sandbox_task", parameters: { task: `run ${script} for two steps` } },
		},
	],
});

/**
 * first-gpu-job's real matching entry: contextFor re-derives the script facts from the stored
 * conversation, so no test here can pass a hand-written `sandboxedScript`. `sandboxUsed` is the
 * mined fact contextFor keeps, and the conversations below hold the sandbox call that set it.
 */
const firstGpuContext = (action: Action, messages: Message[]): DecisionCase["context"] =>
	contextFor(
		{
			family: "first-gpu-job",
			context: { sandboxUsed: true },
			conversation: { model: "test/model", messages },
		} as DecisionCase,
		action
	);

describe("gpuMemoryGb", () => {
	it("compares flavors by total GPU memory", () => {
		expect(gpuMemoryGb("cpu-basic")).toBe(0);
		expect(gpuMemoryGb("t4-small")).toBe(16);
		expect(gpuMemoryGb("a10g-largex2")).toBe(48);
		expect(gpuMemoryGb("a100-large")).toBe(80);
	});
});

const sandbox: ActionCall = {
	name: "sandbox_task",
	args: { task: "run v-file://train.py for two steps" },
};

describe("first-gpu-job", () => {
	const gpuJob = calls(job({ flavor: "a10g-small" }));

	it("passes going to a sandbox, or a job whose script already ran in one", () => {
		expect(label("first-gpu-job", calls(sandbox))).toEqual({
			label: "develop-in-sandbox",
			pass: true,
		});
		expect(
			label("first-gpu-job", gpuJob, {
				sandboxUsed: true,
				script: "train.py",
				sandboxedScript: true,
			})
		).toEqual({ label: "job-after-sandboxing-script", pass: true });
	});

	it("fails a job with no sandbox work before it, and leaves unrelated sandbox work to a reviewer", () => {
		expect(label("first-gpu-job", gpuJob, { sandboxUsed: false })).toEqual({
			label: "job-without-sandbox",
			pass: false,
		});
		expect(
			label("first-gpu-job", gpuJob, {
				sandboxUsed: true,
				script: "train.py",
				sandboxedScript: false,
			})
		).toEqual({ label: "job-after-other-sandbox-work", pass: null });
	});

	it("does not take a same-named script in another directory for the sandboxed one", () => {
		const nestedJob = calls(job({ flavor: "a10g-small", script: "v-file://candidate/train.py" }));
		const context = firstGpuContext(nestedJob, [sandboxCall("v-file://baseline/train.py")]);
		expect(
			context.sandboxedScript,
			"baseline/train.py running in a sandbox says nothing about candidate/train.py"
		).not.toBe(true);
		expect(label("first-gpu-job", nestedJob, context)).toEqual({
			label: "job-after-other-sandbox-work",
			pass: null,
		});
	});
});

describe("after-job-failure", () => {
	it("passes reproducing in a sandbox and fails resubmitting", () => {
		expect(label("after-job-failure", calls(sandbox))).toEqual({
			label: "reproduce-in-sandbox",
			pass: true,
		});
		expect(label("after-job-failure", calls(edit("fix"), job({ flavor: "a10g-small" })))).toEqual({
			label: "fix-and-resubmit",
			pass: false,
		});
		expect(label("after-job-failure", calls(job({ flavor: "a10g-small" })))).toEqual({
			label: "resubmit",
			pass: false,
		});
	});

	it("does not count running a different script as a resubmit", () => {
		const other = job({ flavor: "cpu-basic", script: "v-file://strip.py" });
		expect(
			label("after-job-failure", calls(edit("x"), other), { failedScript: "train.py" })
		).toEqual({ label: "different-job", pass: null });
		expect(
			label("after-job-failure", calls(job({ flavor: "a10g-small" })), { failedScript: "train.py" })
		).toEqual({ label: "resubmit", pass: false });
	});

	it("reads a nested v-file path under another name as a different job", () => {
		const other = job({ flavor: "cpu-basic", script: "v-file://scripts/strip.py@v2" });
		expect(
			label("after-job-failure", calls(edit("x"), other), { failedScript: "train.py" })
		).toEqual({ label: "different-job", pass: null });
	});

	it("reads an untagged nested v-file path under another name as a different job", () => {
		const other = job({ flavor: "cpu-basic", script: "v-file://scripts/strip.py" });
		expect(label("after-job-failure", calls(other), { failedScript: "train.py" })).toEqual({
			label: "different-job",
			pass: null,
		});
	});

	/** failedScript is stored as `jobScript` reads it: the path the failed job named, no version tag */
	it("reads the same file name in another directory as a different job", () => {
		const edited = job({ flavor: "a10g-small", script: "v-file://candidate/train.py@v2" });
		expect(
			label("after-job-failure", calls(edit("lr=1e-4"), edited), {
				failedScript: "baseline/train.py",
			})
		).toEqual({ label: "different-job", pass: null });
	});

	it("reads a new version of the failed path as a resubmit, edited or not", () => {
		const resubmitted = job({ flavor: "a10g-small", script: "v-file://baseline/train.py@v2" });
		expect(
			label("after-job-failure", calls(resubmitted), { failedScript: "baseline/train.py" })
		).toEqual({ label: "resubmit", pass: false });
		expect(
			label("after-job-failure", calls(edit("lr=1e-4"), resubmitted), {
				failedScript: "baseline/train.py",
			})
		).toEqual({ label: "fix-and-resubmit", pass: false });
	});

	it("does not judge reading the logs", () => {
		expect(
			label("after-job-failure", calls({ name: "check_job", args: { job_id: "x", task: "why" } }))
		).toEqual({ label: "investigate", pass: null });
	});
});

describe("after-oom", () => {
	it("fails a bigger flavor with the same config", () => {
		expect(
			label("after-oom", calls(job({ flavor: "l4x1" })), { failedFlavor: "t4-small" })
		).toEqual({ label: "upsize-only", pass: false });
	});

	it("passes a memory fix, with or without a bigger flavor", () => {
		expect(label("after-oom", calls(edit("per_device_train_batch_size=4")))).toEqual({
			label: "fix-memory",
			pass: true,
		});
		expect(
			label("after-oom", calls(edit("gradient_checkpointing=True"), job({ flavor: "l4x1" })), {
				failedFlavor: "t4-small",
			})
		).toEqual({ label: "fix-and-upsize", pass: true });
	});
});

describe("after-stale-api", () => {
	it("passes a docs or source lookup and fails a blind edit", () => {
		expect(
			label(
				"after-stale-api",
				calls({ name: "hf_fs", args: { operations: [{ cmd: "cat", args: ["hf://docs/trl"] }] } })
			)
		).toEqual({ label: "lookup", pass: true });
		expect(label("after-stale-api", calls(edit("warmup_steps=10")))).toEqual({
			label: "blind-fix",
			pass: false,
		});
	});

	it("reads sandbox patches and signature checks", () => {
		const exec = (command: string): ActionCall => ({
			name: "hf_sandbox_exec",
			args: { cmd: "exec", args: ["exec", "hfsb2:me:1", command] },
		});
		expect(
			label("after-stale-api", calls(exec("sed -i 's/, flush_ok=True//' a.py && python a.py")))
		).toEqual({ label: "blind-fix-and-resubmit", pass: false });
		expect(
			label(
				"after-stale-api",
				calls({
					name: "hf_sandbox_fs",
					args: {
						cmd: "write",
						args: ["write", "hfsb2:me:1", "/c.py", "--text", "inspect.signature(f)"],
					},
				})
			)
		).toEqual({ label: "lookup", pass: true });
	});

	it("does not judge a turn that ended or asked", () => {
		expect(label("after-stale-api", { kind: "final", text: "Done" }).pass).toBeNull();
		expect(
			label("after-stale-api", calls({ name: "ask_user_question", args: {} })).pass
		).toBeNull();
	});
});
