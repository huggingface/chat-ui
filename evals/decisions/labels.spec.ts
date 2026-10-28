import { describe, expect, it } from "vitest";
import { gpuMemoryGb, label as rawLabel, LABELS } from "./labels";
import type { ActionCall } from "./types";

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
