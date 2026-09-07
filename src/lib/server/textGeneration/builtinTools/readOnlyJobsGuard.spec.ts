import { describe, expect, it } from "vitest";
import { createReadOnlyJobsGuard } from "./readOnlyJobsGuard";

const guard = createReadOnlyJobsGuard("hf_jobs");
const call = (fnName: string, args: Record<string, unknown>) => ({
	serverUrl: "https://hf.co/mcp",
	tool: "jobs",
	fnName,
	args,
	callUuid: "u1",
});

describe("read-only jobs guard", () => {
	it("allows the operations that only read", async () => {
		for (const operation of ["logs", "inspect", "ps"]) {
			expect((await guard.before(call("hf_jobs", { operation }))).allow).toBe(true);
		}
	});

	it("refuses the ones that spend", async () => {
		// The whole reason the watcher can exist: a sub-agent's calls bypass the
		// parent's budget gate, so it must hold nothing that can book compute.
		// The allowlist is by tool name and `hf_jobs` decides this on an argument,
		// so the restriction has to live here.
		for (const operation of ["uv", "run", "cancel", "scheduled uv"]) {
			const verdict = await guard.before(call("hf_jobs", { operation }));
			expect(verdict.allow).toBe(false);
		}
	});

	it("fails closed on an operation it has never heard of", async () => {
		// A spending operation added upstream must be refused by default rather
		// than inherited silently.
		expect((await guard.before(call("hf_jobs", { operation: "teleport" }))).allow).toBe(false);
		expect((await guard.before(call("hf_jobs", {}))).allow).toBe(false);
		expect((await guard.before(call("hf_jobs", { operation: 7 }))).allow).toBe(false);
	});

	it("says which operations are available, so a refusal is correctable", async () => {
		const verdict = await guard.before(call("hf_jobs", { operation: "uv" }));

		if (verdict.allow) throw new Error("expected a refusal");
		expect(verdict.message).toContain("'logs'");
		expect(verdict.message).toContain("cannot submit, cancel or schedule");
	});

	it("ignores tools that are not the one it gates", async () => {
		expect((await guard.before(call("hf_sandbox_exec", { cmd: "exec" }))).allow).toBe(true);
	});

	it("books nothing, so there is nothing to release", async () => {
		expect(await guard.after(undefined, { status: "success", text: "" })).toBeUndefined();
		expect(guard.allowParking).toBe(true);
	});
});
