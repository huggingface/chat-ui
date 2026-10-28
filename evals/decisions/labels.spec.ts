import { describe, expect, it } from "vitest";
import { gpuMemoryGb, label } from "./labels";
import type { ActionCall } from "./types";

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

describe("first-gpu-job", () => {
	it("passes a smoke job and fails a full run", () => {
		expect(
			label("first-gpu-job", calls(job({ flavor: "l4x1", labels: { name: "x-smoke" } })))
		).toEqual({ label: "gpu-smoke-job", pass: true });
		expect(label("first-gpu-job", calls(job({ flavor: "a100-large", timeout: "4h" })))).toEqual({
			label: "gpu-full-job",
			pass: false,
		});
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
