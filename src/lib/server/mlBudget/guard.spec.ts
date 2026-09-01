import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
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

function makeGuard(conversationId: ObjectId, callCounter = { n: 0 }) {
	const guard = createMlBudgetGuard({
		conversationId,
		generationId: "gen-1",
		username: "testuser",
	});
	const before = (tool: string, args: Record<string, unknown>, serverUrl = HF_URL) =>
		guard.before({ serverUrl, tool, args, callUuid: `uuid-${++callCounter.n}` });
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
	async function reserve(id: ObjectId) {
		const { guard, before } = makeGuard(id);
		const verdict = await before("hf_jobs", {
			operation: "uv",
			args: { flavor: "t4-small", timeout: "10m", namespace: "my-org" },
		});
		if (!verdict.allow || verdict.ticket === undefined) throw new Error("expected a ticket");
		return { guard, ticket: verdict.ticket };
	}

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
