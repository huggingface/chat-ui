import { describe, it, expect } from "vitest";
import { createRepeatedCallGuard } from "./repeatedCallGuard";
import { composeGuards, type GuardOutcome, type ToolCallGuard } from "./toolGuard";

const call = (tool: string, args: Record<string, unknown>) => ({
	serverUrl: "https://example.test/mcp",
	tool,
	fnName: tool,
	args,
	callUuid: `uuid-${Math.random()}`,
});

/** One dispatch: ask the guard, and if allowed report how it went. */
async function attempt(
	guard: ToolCallGuard,
	tool: string,
	args: Record<string, unknown>,
	outcome: GuardOutcome
) {
	const verdict = await guard.before(call(tool, args));
	if (!verdict.allow) return { dispatched: false, message: verdict.message };
	await guard.after(verdict.ticket, outcome);
	return { dispatched: true, message: undefined };
}

const failed = (text: string): GuardOutcome => ({ status: "error", text });
const worked: GuardOutcome = { status: "success", text: "ok" };

describe("repeated tool call guard", () => {
	const badArgs = { cmd: "exec", timeout: 55 };
	const rejection = 'Unrecognized key: "timeout"';

	it("refuses the third identical call that failed identically twice", async () => {
		const guard = createRepeatedCallGuard();

		expect((await attempt(guard, "hf_sandbox_exec", badArgs, failed(rejection))).dispatched).toBe(
			true
		);
		expect((await attempt(guard, "hf_sandbox_exec", badArgs, failed(rejection))).dispatched).toBe(
			true
		);
		const third = await attempt(guard, "hf_sandbox_exec", badArgs, failed(rejection));

		expect(third.dispatched).toBe(false);
		// The refusal has to carry the original error: it is the only account of
		// the failure the model gets on this round.
		expect(third.message).toContain(rejection);
		expect(third.message).toContain("hf_sandbox_exec");
	});

	it("lets an identical retry through after one failure", async () => {
		// The Hub write that lost a race: resending it verbatim is the fix.
		const guard = createRepeatedCallGuard();
		const write = { cmd: "put", path: "README.md" };

		await attempt(guard, "hf_fs_write", write, failed("The branch was updated since you opened"));
		const retry = await attempt(guard, "hf_fs_write", write, worked);

		expect(retry.dispatched).toBe(true);
	});

	it("lets a poll through again after refusing it, then forgets it on success", async () => {
		// Polling is identical calls by nature. A job answering "not found" twice
		// while it starts up must not become unpollable for the rest of the turn.
		const guard = createRepeatedCallGuard();
		const poll = { operation: "logs", job_id: "j1" };

		await attempt(guard, "hf_jobs", poll, failed("job not found"));
		await attempt(guard, "hf_jobs", poll, failed("job not found"));
		expect((await attempt(guard, "hf_jobs", poll, worked)).dispatched).toBe(false);

		const afterRefusal = await attempt(guard, "hf_jobs", poll, worked);
		expect(afterRefusal.dispatched).toBe(true);

		// The success cleared the record, so the next poll is not near a refusal.
		const later = await attempt(guard, "hf_jobs", poll, worked);
		expect(later.dispatched).toBe(true);
	});

	it("tolerates twice as many failures after each refusal", async () => {
		const guard = createRepeatedCallGuard();
		const args = { cmd: "exec" };
		const fail = () => attempt(guard, "hf_sandbox_exec", args, failed(rejection));

		await fail();
		await fail();
		expect((await fail()).dispatched).toBe(false);

		// The next window is four, so a stuck model spends ever fewer dispatches
		// finding out, without any call being blocked forever.
		for (let i = 0; i < 4; i += 1) expect((await fail()).dispatched).toBe(true);
		expect((await fail()).dispatched).toBe(false);
	});

	it("restarts the count when the same arguments fail differently", async () => {
		const guard = createRepeatedCallGuard();
		const args = { uri: "hf://models/x" };

		await attempt(guard, "hf_fs", args, failed("Repository not found"));
		await attempt(guard, "hf_fs", args, failed("EINVAL: max_bytes must be between 0 and 80000"));
		const third = await attempt(
			guard,
			"hf_fs",
			args,
			failed("EINVAL: max_bytes must be between 0 and 80000")
		);

		// A moving target, not a stuck one: only the second error has repeated.
		expect(third.dispatched).toBe(true);
	});

	it("ignores a transport error, which says nothing about the arguments", async () => {
		const guard = createRepeatedCallGuard();
		const args = { cmd: "status" };

		await attempt(guard, "hf_sandbox", args, { status: "transport_error" });
		await attempt(guard, "hf_sandbox", args, { status: "transport_error" });
		const third = await attempt(guard, "hf_sandbox", args, { status: "transport_error" });

		expect(third.dispatched).toBe(true);
	});

	it("keys on argument values, not their order", async () => {
		const guard = createRepeatedCallGuard();

		await attempt(guard, "hf_sandbox_exec", { cmd: "exec", timeout: 55 }, failed(rejection));
		await attempt(guard, "hf_sandbox_exec", { timeout: 55, cmd: "exec" }, failed(rejection));
		const third = await attempt(
			guard,
			"hf_sandbox_exec",
			{ cmd: "exec", timeout: 55 },
			failed(rejection)
		);

		expect(third.dispatched).toBe(false);
	});

	it("keeps two servers exporting the same tool name apart", async () => {
		// Colliding names are suffixed for the model but the server tool name is
		// unchanged, so keying on that would let one server's failures refuse the
		// first attempt at the other.
		const guard = createRepeatedCallGuard();
		const args = { cmd: "exec" };
		const onServer = (fnName: string) => ({
			serverUrl: `https://${fnName}.test/mcp`,
			tool: "hf_sandbox_exec",
			fnName,
			args,
			callUuid: `uuid-${Math.random()}`,
		});
		for (let i = 0; i < 2; i += 1) {
			const verdict = await guard.before(onServer("hf_sandbox_exec"));
			if (verdict.allow) await guard.after(verdict.ticket, failed(rejection));
		}

		// Asked before the refusal that would reset the count: the other server has
		// to be untouched by those two failures, not merely past a decayed one.
		expect((await guard.before(onServer("hf_sandbox_exec_other"))).allow).toBe(true);
		expect((await guard.before(onServer("hf_sandbox_exec"))).allow).toBe(false);
	});

	it("keeps different arguments apart", async () => {
		const guard = createRepeatedCallGuard();

		await attempt(guard, "hf_sandbox_exec", { cmd: "exec", script: "a" }, failed(rejection));
		await attempt(guard, "hf_sandbox_exec", { cmd: "exec", script: "a" }, failed(rejection));
		const other = await attempt(
			guard,
			"hf_sandbox_exec",
			{ cmd: "exec", script: "b" },
			failed(rejection)
		);

		expect(other.dispatched).toBe(true);
	});
});

describe("composeGuards", () => {
	const allowAll = (): ToolCallGuard => ({
		allowParking: true,
		before: async () => ({ allow: true, ticket: "inner" }),
		after: async () => undefined,
	});

	it("never consults the second guard once the first refuses", async () => {
		const guard = createRepeatedCallGuard();
		const args = { cmd: "exec" };
		await attempt(guard, "t", args, failed("nope"));
		await attempt(guard, "t", args, failed("nope"));

		let consulted = false;
		const second: ToolCallGuard = {
			allowParking: true,
			before: async () => {
				consulted = true;
				return { allow: true, ticket: "inner" };
			},
			after: async () => undefined,
		};

		const verdict = await composeGuards(guard, second).before(call("t", args));

		expect(verdict.allow).toBe(false);
		// A budget guard behind this one must not reserve for a call that is not
		// being made — nothing would release it.
		expect(consulted).toBe(false);
	});

	it("reports both fates through one ticket", async () => {
		const seen: GuardOutcome[] = [];
		const recording: ToolCallGuard = {
			allowParking: true,
			before: async () => ({ allow: true, ticket: "inner" }),
			after: async (_ticket, outcome) => {
				seen.push(outcome);
				return undefined;
			},
		};
		const repeated = createRepeatedCallGuard();
		const composed = composeGuards(repeated, recording);

		const verdict = await composed.before(call("t", { a: 1 }));
		if (!verdict.allow) throw new Error("expected the call to be allowed");
		await composed.after(verdict.ticket, failed("boom"));
		await composed.after(verdict.ticket, failed("boom"));

		expect(seen).toHaveLength(2);
		// The repeat guard counted the same two failures behind the same ticket.
		const third = await composed.before(call("t", { a: 1 }));
		expect(third.allow).toBe(false);
	});

	it("parks only when both guards allow it", async () => {
		const noParking: ToolCallGuard = { ...allowAll(), allowParking: false };
		expect(composeGuards(createRepeatedCallGuard(), noParking).allowParking).toBe(false);
		expect(composeGuards(createRepeatedCallGuard(), allowAll()).allowParking).toBe(true);
	});
});
