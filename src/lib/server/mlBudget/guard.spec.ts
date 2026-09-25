import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { logger } from "$lib/server/logger";
import { MessageUpdateType } from "$lib/types/MessageUpdate";
import type { MlBudget } from "$lib/types/Conversation";
import { createMlBudgetGuard, withRequiredDiscriminators } from "./guard";
import { readMlBudget } from "./budget";
import { resetPriceCacheForTests } from "./pricing";

beforeAll(async () => {
	await ready;
});

// Offline pricing: every test runs on the baked-in snapshot, deterministically.
beforeEach(() => {
	resetPriceCacheForTests();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => {
			throw new Error("offline");
		})
	);
});

const createdIds: ObjectId[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await collections.conversations.deleteMany({ _id: { $in: createdIds } });
	createdIds.length = 0;
});

async function insertConversation(mlBudget?: MlBudget): Promise<ObjectId> {
	const _id = new ObjectId();
	createdIds.push(_id);
	await collections.conversations.insertOne({
		_id,
		title: "guard test",
		model: "test-model",
		messages: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: `guard-test-${_id.toString()}`,
		mlAssistant: true,
		...(mlBudget ? { mlBudget } : {}),
	});
	return _id;
}

const HF_URL = "https://hf.co/mcp?login";

function makeGuard(conversationId: ObjectId, callCounter = { n: 0 }, token?: string) {
	const guard = createMlBudgetGuard({
		conversationId,
		generationId: "gen-1",
		username: "testuser",
		...(token ? { token } : {}),
	});
	const before = (tool: string, args: Record<string, unknown>, serverUrl = HF_URL) =>
		guard.before({ serverUrl, tool, fnName: tool, args, callUuid: `uuid-${++callCounter.n}` });
	return { guard, before };
}

const budgetOf = (totalMicroUsd: number): MlBudget => ({
	totalMicroUsd,
	spentMicroUsd: 0,
	reservations: [],
});

describe.sequential("mlBudget guard: what is gated", () => {
	it("ignores servers that are not the Hub MCP", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(1_000));
		const { before } = makeGuard(id);
		const verdict = await before(
			"hf_jobs",
			{ operation: "run", args: { flavor: "a100-large", timeout: "8h" } },
			"https://other.example/mcp"
		);
		expect(verdict.allow).toBe(true);
		expect((await readMlBudget(id))?.reservations).toHaveLength(0);
	});

	it("never gates reading or stopping", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(0));
		const { before } = makeGuard(id);
		for (const [tool, args] of [
			["hf_jobs", { operation: "logs", args: { job_id: "x" } }],
			["hf_jobs", { operation: "ps" }],
			["hf_jobs", { operation: "inspect", args: { job_id: "x" } }],
			["hf_jobs", { operation: "cancel", args: { job_id: "x" } }],
			["hf_sandbox", { cmd: "status", args: ["handle"] }],
			["hf_sandbox", { cmd: "terminate", args: ["handle"] }],
			["hf_sandbox", { cmd: "kill", args: ["handle", "1"] }],
		] as const) {
			const verdict = await before(tool, args as Record<string, unknown>);
			expect(verdict.allow).toBe(true);
		}
	});

	it("refuses scheduled jobs outright", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(100_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", { operation: "scheduled run", args: {} });
		expect(verdict.allow).toBe(false);
		if (!verdict.allow) expect(verdict.message).toContain("Scheduled jobs");
	});

	// The observed bypass: submission-shaped args with no operation sailed
	// through as a "read". Anything the gate cannot recognize fails closed.
	it("fails closed on a call it cannot classify", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(100_000_000));
		const { before } = makeGuard(id);

		const missingOp = await before("hf_jobs", {
			args: { command: ["python", "-c", "print(1)"], flavor: "cpu-basic", timeout: 5 },
		});
		expect(missingOp.allow).toBe(false);
		if (!missingOp.allow) expect(missingOp.message).toContain("without an operation");

		const unknownOp = await before("hf_jobs", { operation: "yolo", args: {} });
		expect(unknownOp.allow).toBe(false);
		if (!unknownOp.allow) expect(unknownOp.message).toContain('"yolo"');

		const unknownCmd = await before("hf_sandbox", { cmd: "shell", args: [] });
		expect(unknownCmd.allow).toBe(false);

		expect((await readMlBudget(id))?.reservations).toHaveLength(0);
	});
});

describe.sequential("mlBudget guard: pricing the submission", () => {
	it("reserves the flavor × timeout ceiling for a job", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", {
			operation: "uv",
			args: { flavor: "a10g-large", timeout: "1h", script: "train.py" },
		});
		expect(verdict.allow).toBe(true);
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(1);
		// a10g-large: 25_000 µUSD/min × 60 min
		expect(budget?.reservations[0].ceilingMicroUsd).toBe(1_500_000);
		expect(budget?.reservations[0].kind).toBe("job");
		if (verdict.allow) {
			expect(verdict.update).toMatchObject({
				type: MessageUpdateType.Budget,
				reservedMicroUsd: 1_500_000,
			});
		}
	});

	it("prices a job by the platform defaults when args are silent", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", { operation: "run", args: { image: "python:3.12" } });
		expect(verdict.allow).toBe(true);
		const budget = await readMlBudget(id);
		// cpu-basic (167 µUSD/min) × default 30 min timeout
		expect(budget?.reservations[0].ceilingMicroUsd).toBe(167 * 30);
	});

	it("prices a sandbox create from its flags", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_sandbox", {
			cmd: "create",
			args: ["create", "--flavor", "t4-small", "--timeout", "30m"],
		});
		expect(verdict.allow).toBe(true);
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].ceilingMicroUsd).toBe(6667 * 30);
		expect(budget?.reservations[0].kind).toBe("sandbox");
	});

	it("requires explicit sandbox sizing", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_sandbox", { cmd: "create", args: ["create"] });
		expect(verdict.allow).toBe(false);
		if (!verdict.allow) expect(verdict.message).toContain("--flavor and --timeout");
	});

	it("fails closed on a flavor nobody prices", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", {
			operation: "run",
			args: { flavor: "quantum-x9000", timeout: "1h" },
		});
		expect(verdict.allow).toBe(false);
		if (!verdict.allow) expect(verdict.message).toContain("quantum-x9000");
		expect((await readMlBudget(id))?.reservations).toHaveLength(0);
	});

	it("fails closed on an unparseable timeout", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", {
			operation: "run",
			args: { flavor: "t4-small", timeout: "until it converges" },
		});
		expect(verdict.allow).toBe(false);
	});

	it(
		"treats a conversation without a stored budget as a zero grant",
		{ timeout: 15000 },
		async () => {
			const id = await insertConversation();
			const { before } = makeGuard(id);
			const verdict = await before("hf_jobs", {
				operation: "run",
				args: { flavor: "t4-small", timeout: "10m" },
			});
			expect(verdict.allow).toBe(false);
			if (!verdict.allow) {
				expect(verdict.message).toContain("no compute budget granted");
				expect(verdict.message).toContain("setBudgetUsd");
			}
		}
	);

	it("refuses what the remaining budget cannot cover, with the numbers", async () => {
		const id = await insertConversation(budgetOf(1_000_000));
		const { before } = makeGuard(id);
		const verdict = await before("hf_jobs", {
			operation: "uv",
			args: { flavor: "a10g-large", timeout: "1h" },
		});
		expect(verdict.allow).toBe(false);
		if (!verdict.allow) {
			expect(verdict.message).toContain("$1.50"); // the ceiling
			expect(verdict.message).toContain("$1.00"); // remaining and total
			expect(verdict.message).toContain("Nothing was submitted");
		}
		expect((await readMlBudget(id))?.reservations).toHaveLength(0);
	});
});

describe.sequential("mlBudget guard: reconciling the outcome", () => {
	async function reserve(id: ObjectId, kind: "job" | "sandbox" = "job") {
		const { guard, before } = makeGuard(id);
		const verdict =
			kind === "job"
				? await before("hf_jobs", {
						operation: "uv",
						args: {
							flavor: "t4-small",
							timeout: "10m",
							namespace: "my-org",
							resource_group_id: "65f000000000000000000001",
						},
					})
				: await before("hf_sandbox", {
						cmd: "create",
						args: ["create", "--flavor", "t4-small", "--timeout", "10m", "--namespace", "my-org"],
					});
		if (!verdict.allow || verdict.ticket === undefined) throw new Error("expected a ticket");
		return { guard, ticket: verdict.ticket };
	}

	const JOB_ID = "0123456789abcdef01234567";
	const SANDBOX_JOB_ID = "abcdefabcdefabcdefabcdef";
	const OTHER_ID = "fedcba9876543210fedcba98";

	const jobResult = (job: Record<string, unknown>) => ({
		operation: "uv",
		outcome: { kind: "job", job, logs: ["..."], logs_finished: false, logs_truncated: false },
		total_results: 1,
		results_shared: 1,
	});
	const JOB = {
		id: JOB_ID,
		url: `https://huggingface.co/jobs/testuser/${JOB_ID}`,
		flavor: "a10g-small",
		status: { stage: "SCHEDULING", message: null },
		owner: { id: "u1", name: "testuser", type: "user" },
		timeout_seconds: 1800,
	};

	it("takes a job's id and owner from the structured result", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, {
			status: "success",
			text: "Job started.",
			structured: jobResult(JOB),
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe(JOB_ID);
		expect(budget?.reservations[0].namespace).toBe("testuser");
	});

	it(
		"takes a sandbox's id and namespace from the structured result",
		{ timeout: 15000 },
		async () => {
			const id = await insertConversation(budgetOf(10_000_000));
			const { guard, ticket } = await reserve(id, "sandbox");
			await guard.after(ticket, {
				status: "success",
				text: "Sandbox ready.",
				structured: {
					op: "create",
					handle: `hfsb2:testuser:${SANDBOX_JOB_ID}`,
					name: "smoke",
					namespace: "testuser",
					job_id: SANDBOX_JOB_ID,
					url: `https://${SANDBOX_JOB_ID}--49983.hf.jobs`,
					job_url: `https://huggingface.co/jobs/testuser/${SANDBOX_JOB_ID}`,
					volumes: [],
				},
			});
			const budget = await readMlBudget(id);
			expect(budget?.reservations[0].jobId).toBe(SANDBOX_JOB_ID);
			expect(budget?.reservations[0].namespace).toBe("testuser");
		}
	);

	it("believes the structured id over a job url the job printed", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, {
			status: "success",
			text: `Job started: ${JOB_ID}\n\nLogs:\nresuming from https://huggingface.co/jobs/someone-else/${OTHER_ID}`,
			structured: jobResult(JOB),
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe(JOB_ID);
		expect(budget?.reservations[0].namespace).toBe("testuser");
	});

	it("falls back to the submission's namespace when the owner is unusable", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, {
			status: "success",
			text: "Job started.",
			structured: jobResult({ ...JOB, owner: { name: "../../api/whoami" } }),
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe(JOB_ID);
		expect(budget?.reservations[0].namespace).toBe("my-org");
	});

	it("reads a bare id from the text when there is no structured result", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		const warn = vi.spyOn(logger, "warn");
		await guard.after(ticket, { status: "success", text: `Job started: ${JOB_ID}` });
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe(JOB_ID);
		expect(budget?.reservations[0].namespace).toBe("my-org");
		expect(warn).not.toHaveBeenCalled();
	});

	it.each([
		["is not an object", "job started"],
		["has an id of the wrong type", jobResult({ ...JOB, id: 42 })],
		["has an id that is not 24 lowercase hex", jobResult({ ...JOB, id: JOB_ID.toUpperCase() })],
		["has an id with something appended", jobResult({ ...JOB, id: `${JOB_ID}/../x` })],
	])(
		"falls back to the text, and says so, when the structured result %s",
		{ timeout: 15000 },
		async (_label, structured) => {
			const id = await insertConversation(budgetOf(10_000_000));
			const { guard, ticket } = await reserve(id);
			const warn = vi.spyOn(logger, "warn");
			await guard.after(ticket, {
				status: "success",
				text: `Job started: https://huggingface.co/jobs/my-org/${OTHER_ID}`,
				structured,
			});
			const budget = await readMlBudget(id);
			expect(budget?.reservations[0].jobId).toBe(OTHER_ID);
			expect(budget?.reservations[0].namespace).toBe("my-org");
			expect(warn).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("structured result had no usable job id")
			);
		}
	);

	it("keeps the hold, and warns, when neither part names a job", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		const warn = vi.spyOn(logger, "warn");
		await guard.after(ticket, {
			status: "success",
			text: "Job started.",
			structured: jobResult({ ...JOB, id: "nope" }),
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(1);
		expect(budget?.reservations[0].jobId).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining("no job id was found")
		);
	});

	it(
		"refunds a usage-help reply even when its text quotes a job id",
		{ timeout: 15000 },
		async () => {
			const id = await insertConversation(budgetOf(10_000_000));
			const { guard, ticket } = await reserve(id);
			const update = await guard.after(ticket, {
				status: "success",
				text: `# Command help: uv\n\nExample: hf jobs logs ${OTHER_ID}`,
				structured: {
					operation: "uv",
					outcome: {
						kind: "help",
						operation: "uv",
						reason: "requested",
						instructions: "# Command help: uv ...",
					},
					total_results: 0,
					results_shared: 0,
				},
			});
			const budget = await readMlBudget(id);
			expect(budget?.reservations).toHaveLength(0);
			expect(budget?.spentMicroUsd).toBe(0);
			expect(update).toMatchObject({ type: MessageUpdateType.Budget, reservedMicroUsd: 0 });
		}
	);

	it("attaches the job id from a submission response", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, {
			status: "success",
			text: "Job started: https://huggingface.co/jobs/my-org/0123456789abcdef01234567",
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe("0123456789abcdef01234567");
		expect(budget?.reservations[0].namespace).toBe("my-org");
		expect(budget?.reservations[0].resourceGroupId).toBe("65f000000000000000000001");
	});

	it("reads a sandbox handle", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, {
			status: "success",
			text: "Sandbox ready. Handle: hfsb2:testuser:abcdefabcdefabcdefabcdef",
		});
		const budget = await readMlBudget(id);
		expect(budget?.reservations[0].jobId).toBe("abcdefabcdefabcdefabcdef");
		expect(budget?.reservations[0].namespace).toBe("testuser");
	});

	it("refunds a clean server-side error", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		const update = await guard.after(ticket, { status: "error", text: "invalid image" });
		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(0);
		expect(budget?.spentMicroUsd).toBe(0);
		expect(update).toMatchObject({ type: MessageUpdateType.Budget, reservedMicroUsd: 0 });
	});

	it("refunds a declined elicitation", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, { status: "elicited" });
		expect((await readMlBudget(id))?.reservations).toHaveLength(0);
	});

	it("keeps the hold when the outcome is unknowable", { timeout: 15000 }, async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, ticket } = await reserve(id);
		await guard.after(ticket, { status: "transport_error" });
		expect((await readMlBudget(id))?.reservations).toHaveLength(1);
	});
});

describe("withRequiredDiscriminators", () => {
	const tool = (name: string, parameters?: Record<string, unknown>) => ({
		type: "function" as const,
		function: { name, ...(parameters ? { parameters } : {}) },
	});
	const MAPPING = {
		hf_jobs: { fnName: "hf_jobs", server: "Hugging Face", tool: "hf_jobs" },
		hf_sandbox: { fnName: "hf_sandbox", server: "Hugging Face", tool: "hf_sandbox" },
		hf_fs: { fnName: "hf_fs", server: "Hugging Face", tool: "hf_fs" },
	};

	it("requires the routing discriminator on the gated tools", () => {
		const shaped = withRequiredDiscriminators(
			[
				tool("hf_jobs", { type: "object", properties: { operation: {}, args: {} } }),
				tool("hf_sandbox", {
					type: "object",
					properties: { cmd: {}, args: {} },
					required: ["cmd", "args"],
				}),
				tool("hf_fs", { type: "object", properties: { operations: {} } }),
			],
			MAPPING
		);
		expect(shaped[0].function.parameters?.required).toEqual(["operation"]);
		// Already required: returned untouched, not duplicated.
		expect(shaped[1].function.parameters?.required).toEqual(["cmd", "args"]);
		expect(shaped[2].function.parameters?.required).toBeUndefined();
	});

	it("never mutates the cached originals", () => {
		const original = tool("hf_jobs", { type: "object", properties: { operation: {} } });
		withRequiredDiscriminators([original], MAPPING);
		expect(original.function.parameters?.required).toBeUndefined();
	});
});

describe.sequential("mlBudget guard: settling when something stops", () => {
	it("tickets a terminate so its success can reconcile the ledger", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);

		const verdict = await before("hf_sandbox", {
			cmd: "terminate",
			args: ["terminate", "hfsb2:x:y"],
		});

		// Not gated — stops never are — but ticketed, because `after` only runs
		// for a call that issued one, and this is the moment a hold ends.
		expect(verdict.allow).toBe(true);
		if (verdict.allow) expect(verdict.ticket).toEqual({ kind: "release" });
	});

	it("tickets a job cancel the same way", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);

		const verdict = await before("hf_jobs", { operation: "cancel", args: { job_id: "abc" } });

		expect(verdict.allow).toBe(true);
		if (verdict.allow) expect(verdict.ticket).toEqual({ kind: "release" });
	});

	it("leaves an ordinary read unticketed, so nothing settles on a log call", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { before } = makeGuard(id);

		const verdict = await before("hf_jobs", { operation: "logs", args: { job_id: "abc" } });

		expect(verdict.allow).toBe(true);
		if (verdict.allow) expect(verdict.ticket).toBeUndefined();
	});

	it("settles a finished sandbox on terminate instead of waiting for the next turn", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, before } = makeGuard(id, { n: 0 }, "hf_test_token");
		const created = await before("hf_sandbox", {
			cmd: "create",
			args: ["create", "--flavor", "cpu-basic", "--timeout", "1h"],
		});
		if (!created.allow) throw new Error("expected the create to be allowed");
		// The handle the sandbox came back with, so the hold becomes traceable.
		await guard.after(created.ticket, {
			status: "success",
			text: "Sandbox ready: hfsb2:testuser:6a99a386e686246ca699f46f",
		});
		expect((await readMlBudget(id))?.reservations).toHaveLength(1);

		// The Jobs API now reports it finished after a minute.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({ status: { stage: "COMPLETED" }, billedMinutes: 1 }),
			}))
		);
		const stop = await before("hf_sandbox", {
			cmd: "terminate",
			args: ["terminate", "hfsb2:testuser:6a99a386e686246ca699f46f"],
		});
		if (!stop.allow) throw new Error("expected the terminate to be allowed");
		const update = await guard.after(stop.ticket, { status: "success", text: "terminated" });

		const budget = await readMlBudget(id);
		expect(budget?.reservations).toHaveLength(0);
		// The strip has to hear about it while the turn is still running.
		expect(update).toMatchObject({ type: MessageUpdateType.Budget });
	});

	it("keeps the hold when the terminate itself failed", async () => {
		const id = await insertConversation(budgetOf(10_000_000));
		const { guard, before } = makeGuard(id, { n: 0 }, "hf_test_token");
		const created = await before("hf_sandbox", {
			cmd: "create",
			args: ["create", "--flavor", "cpu-basic", "--timeout", "1h"],
		});
		if (!created.allow) throw new Error("expected the create to be allowed");

		const stop = await before("hf_sandbox", { cmd: "terminate", args: ["terminate", "h"] });
		if (!stop.allow) throw new Error("expected the terminate to be allowed");
		const update = await guard.after(stop.ticket, { status: "error", text: "no such sandbox" });

		expect(update).toBeUndefined();
		expect((await readMlBudget(id))?.reservations).toHaveLength(1);
	});
});
