import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import type { GuardedToolCall, ToolCallGuard } from "$lib/server/textGeneration/mcp/toolGuard";
import type { MlService } from "$lib/types/MlService";
import {
	createSandboxFirstGuard,
	failedJobsRefusal,
	firstGpuJobRefusal,
} from "./sandboxFirstGuard";

beforeAll(async () => {
	await ready;
});

const conversationIds: ObjectId[] = [];

afterEach(async () => {
	await collections.mlServices.deleteMany({ conversationId: { $in: conversationIds } });
	conversationIds.length = 0;
});

const newConversationId = () => {
	const id = new ObjectId();
	conversationIds.push(id);
	return id;
};

const HF_URL = "https://hf.co/mcp?login";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

const job = (flavor = "a10g-small"): GuardedToolCall => ({
	serverUrl: HF_URL,
	tool: "hf_jobs",
	fnName: "hf_jobs",
	args: { operation: "uv", args: { script: "print(1)", flavor, timeout: "20m" } },
	callUuid: "call-1",
});

const sandboxCreate: GuardedToolCall = {
	serverUrl: HF_URL,
	tool: "hf_sandbox",
	fnName: "hf_sandbox",
	args: { cmd: "create", args: ["create", "--flavor", "a10g-small", "--timeout", "1h"] },
	callUuid: "call-2",
};

async function record(
	conversationId: ObjectId,
	kind: MlService["kind"],
	{ stage = "RUNNING", createdAt = new Date(), endedAt }: Partial<MlService> = {}
) {
	await collections.mlServices.insertOne({
		_id: new ObjectId(),
		conversationId,
		kind,
		jobId: new ObjectId().toHexString(),
		namespace: "user",
		stage,
		origin: "dispatched",
		hubUrl: HF_URL,
		createdAt,
		updatedAt: endedAt ?? createdAt,
		...(endedAt ? { endedAt } : {}),
	});
}

const verdictOf = (guard: ToolCallGuard, call = job()) => guard.before(call);

describe("sandbox-first guard", () => {
	it("refuses the session's first GPU job until a sandbox exists", async () => {
		const conversationId = newConversationId();
		const guard = createSandboxFirstGuard({ conversationId });

		expect(await verdictOf(guard)).toEqual({
			allow: false,
			message: firstGpuJobRefusal("a10g-small"),
		});

		await record(conversationId, "sandbox", { stage: "COMPLETED", endedAt: minutesAgo(1) });
		expect(await verdictOf(guard)).toEqual({ allow: true });
	});

	it("lets CPU jobs, reads and sandbox creation through with no sandbox", async () => {
		const guard = createSandboxFirstGuard({ conversationId: newConversationId() });

		expect((await verdictOf(guard, job("cpu-basic"))).allow).toBe(true);
		const omitted = job();
		omitted.args = { operation: "uv", args: { script: "print(1)" } };
		expect((await verdictOf(guard, omitted)).allow).toBe(true);
		expect((await verdictOf(guard, { ...job(), args: { operation: "logs" } })).allow).toBe(true);
		expect((await verdictOf(guard, sandboxCreate)).allow).toBe(true);
	});

	it("refuses any job after two failed in a row until a sandbox was up after them", async () => {
		const conversationId = newConversationId();
		await record(conversationId, "sandbox", {
			stage: "COMPLETED",
			createdAt: minutesAgo(60),
			endedAt: minutesAgo(50),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(40),
			endedAt: minutesAgo(35),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(30),
			endedAt: minutesAgo(25),
		});
		const guard = createSandboxFirstGuard({ conversationId });

		expect(await verdictOf(guard, job("cpu-basic"))).toEqual({
			allow: false,
			message: failedJobsRefusal("cpu-basic"),
		});

		await record(conversationId, "sandbox", { createdAt: minutesAgo(5) });
		expect((await verdictOf(guard)).allow).toBe(true);
	});

	it("counts a sandbox that stayed up across the failures", async () => {
		const conversationId = newConversationId();
		await record(conversationId, "sandbox", { createdAt: minutesAgo(60) });
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(40),
			endedAt: minutesAgo(35),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(30),
			endedAt: minutesAgo(25),
		});

		expect((await verdictOf(createSandboxFirstGuard({ conversationId }))).allow).toBe(true);
	});

	it("ends the streak at a completed job, and skips cancelled and running ones", async () => {
		const conversationId = newConversationId();
		await record(conversationId, "sandbox", {
			stage: "COMPLETED",
			createdAt: minutesAgo(90),
			endedAt: minutesAgo(80),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(70),
			endedAt: minutesAgo(65),
		});
		await record(conversationId, "job", {
			stage: "COMPLETED",
			createdAt: minutesAgo(60),
			endedAt: minutesAgo(50),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(40),
			endedAt: minutesAgo(35),
		});
		const guard = createSandboxFirstGuard({ conversationId });
		expect((await verdictOf(guard)).allow).toBe(true);

		await record(conversationId, "job", {
			stage: "CANCELED",
			createdAt: minutesAgo(30),
			endedAt: minutesAgo(28),
		});
		await record(conversationId, "job", {
			stage: "ERROR",
			createdAt: minutesAgo(20),
			endedAt: minutesAgo(15),
		});
		await record(conversationId, "job", { stage: "RUNNING", createdAt: minutesAgo(10) });
		expect((await verdictOf(guard)).allow).toBe(false);
	});

	it("lifts once a sandbox create fails, so an account without sandboxes can still submit", async () => {
		const guard = createSandboxFirstGuard({ conversationId: newConversationId() });
		const created = await guard.before(sandboxCreate);
		expect(created.allow).toBe(true);
		if (!created.allow) return;

		await guard.after(created.ticket, { status: "error", text: "403 Forbidden" });

		expect((await verdictOf(guard)).allow).toBe(true);
	});

	it("stays on after a sandbox create succeeds", async () => {
		const guard = createSandboxFirstGuard({ conversationId: newConversationId() });
		const created = await guard.before(sandboxCreate);
		if (!created.allow) throw new Error("create refused");

		await guard.after(created.ticket, { status: "success", text: "Created sandbox" });

		expect((await verdictOf(guard)).allow).toBe(false);
	});

	it("ignores tools of the same name on other servers", async () => {
		const guard = createSandboxFirstGuard({ conversationId: newConversationId() });

		expect((await verdictOf(guard, { ...job(), serverUrl: "https://example.com/mcp" })).allow).toBe(
			true
		);
	});
});
