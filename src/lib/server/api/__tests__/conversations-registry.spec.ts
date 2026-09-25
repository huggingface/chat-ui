import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import superjson from "superjson";
import { ready } from "$lib/server/database";
import { recordArtefact, recordDispatchedService } from "$lib/server/mlRegistry/store";
import { startAgentRun } from "$lib/server/mlRegistry/agentRuns";
import { recordSources } from "$lib/server/mlRegistry/sources";
import { PARENT_READER } from "$lib/types/MlSource";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MlAgentRunDetail, MlRegistryPayload } from "$lib/types/MlRegistry";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "./testHelpers";

import { GET } from "../../../../routes/api/v2/conversations/[id]/registry/+server";
import { GET as GET_RUN } from "../../../../routes/api/v2/conversations/[id]/runs/[runId]/+server";

const JOB_ID = "0123456789abcdef01234567";
const SETTLED_JOB_ID = "89abcdef0123456789abcdef";

async function parseResponse(res: Response): Promise<MlRegistryPayload> {
	return superjson.parse(await res.text()) as MlRegistryPayload;
}

const get = async (locals: App.Locals, id: string) => GET({ locals, params: { id } } as never);

async function expectStatus(promise: Promise<Response>, status: number) {
	try {
		await promise;
		expect.fail("Should have thrown");
	} catch (e: unknown) {
		expect((e as { status: number }).status).toBe(status);
	}
}

beforeAll(async () => {
	await ready;
});

describe.sequential("GET /api/v2/conversations/[id]/registry", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	it("throws 401 without a session", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });
		await expectStatus(get(locals, new ObjectId().toString()), 401);
	});

	it("throws 404 for a conversation that does not exist", async () => {
		const { locals } = await createTestUser();
		await expectStatus(get(locals, new ObjectId().toString()), 404);
	});

	it("throws 404 for a share id, whose reader is not the owner", async () => {
		const { locals } = await createTestUser();
		await expectStatus(get(locals, "abcdefg"), 404);
	});

	it("throws 403 for another user's conversation", async () => {
		const { locals: owner } = await createTestUser();
		const { locals: other } = await createTestUser();
		const conv = await createTestConversation(owner);
		await expectStatus(get(other, conv._id.toString()), 403);
	});

	it("returns empty lists and the server clock for a conversation with nothing recorded", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const before = Date.now();

		const res = await get(locals, conv._id.toString());

		expect(res.status).toBe(200);
		const payload = await parseResponse(res);
		expect(payload.services).toEqual([]);
		expect(payload.artefacts).toEqual([]);
		expect(payload.files).toEqual([]);
		expect(payload.agentRuns).toEqual([]);
		expect(payload.sources).toEqual([]);
		expect(payload.serverNow).toBeGreaterThanOrEqual(before);
		expect(payload.serverNow).toBeLessThanOrEqual(Date.now());
	});

	it("returns the conversation's services, artefacts and files with string ids", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const other = await createTestConversation(locals);
		await recordDispatchedService({
			conversationId: conv._id,
			kind: "job",
			jobId: JOB_ID,
			namespace: "pngwn",
			stage: "RUNNING",
			name: "sft-smoke",
			flavor: "a10g-small",
			timeoutSeconds: 3600,
			reservationKey: "gen-1:call-1",
			scriptRefs: [{ name: "train.py", version: 2 }],
		});
		await recordDispatchedService({
			conversationId: other._id,
			kind: "job",
			jobId: SETTLED_JOB_ID,
			namespace: "pngwn",
			stage: "RUNNING",
		});
		await recordArtefact({
			conversationId: conv._id,
			kind: "model",
			uri: "hf://models/pngwn/sft-smoke",
			url: "https://huggingface.co/pngwn/sft-smoke",
		});
		await recordArtefact({
			conversationId: conv._id,
			kind: "file",
			uri: "hf://models/pngwn/sft-smoke/README.md",
			url: "https://huggingface.co/pngwn/sft-smoke/blob/main/README.md",
			commit: "abcdef0123456789",
			fromFile: { name: "README.md", version: 1 },
		});
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(1)\n",
			origin: "write",
		});
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(2)\n",
			origin: "edit",
			summary: "bump",
		});

		const payload = await parseResponse(await get(locals, conv._id.toString()));

		expect(payload.services).toHaveLength(1);
		expect(payload.services[0]).toMatchObject({
			kind: "job",
			jobId: JOB_ID,
			namespace: "pngwn",
			stage: "RUNNING",
			name: "sft-smoke",
			flavor: "a10g-small",
			origin: "dispatched",
			hubUrl: `https://huggingface.co/jobs/pngwn/${JOB_ID}`,
			scriptRefs: [{ name: "train.py", version: 2 }],
		});
		expect(typeof payload.services[0].id).toBe("string");
		expect(payload.services[0]).not.toHaveProperty("_id");
		expect(payload.services[0]).not.toHaveProperty("conversationId");
		expect(payload.services[0].createdAt).toBeInstanceOf(Date);

		expect(payload.artefacts.map((a) => [a.kind, a.uri, a.commit])).toEqual([
			["model", "hf://models/pngwn/sft-smoke", undefined],
			["file", "hf://models/pngwn/sft-smoke/README.md", "abcdef0123456789"],
		]);
		expect(payload.artefacts[1].fromFile).toEqual({ name: "README.md", version: 1 });
		expect(payload.artefacts.every((a) => typeof a.id === "string")).toBe(true);

		expect(payload.files).toEqual([
			{
				name: "train.py",
				version: 2,
				size: 9,
				updatedAt: expect.any(Date),
				summary: "bump",
			},
		]);
	});

	it("joins each service with the ceiling its reservation still holds", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, {
			mlAssistant: true,
			mlBudget: {
				totalMicroUsd: 10_000_000,
				spentMicroUsd: 0,
				reservations: [
					{
						key: "gen-1:call-1",
						kind: "job",
						flavor: "a10g-small",
						priceMicroUsdPerMinute: 20_000,
						timeoutSeconds: 3600,
						ceilingMicroUsd: 1_200_000,
						createdAt: new Date(),
						jobId: JOB_ID,
						namespace: "pngwn",
					},
				],
			},
		});
		await recordDispatchedService({
			conversationId: conv._id,
			kind: "job",
			jobId: JOB_ID,
			namespace: "pngwn",
			stage: "RUNNING",
			reservationKey: "gen-1:call-1",
		});
		// settled, its key is no longer in the ledger
		await recordDispatchedService({
			conversationId: conv._id,
			kind: "job",
			jobId: SETTLED_JOB_ID,
			namespace: "pngwn",
			stage: "COMPLETED",
			reservationKey: "gen-1:call-0",
		});

		const payload = await parseResponse(await get(locals, conv._id.toString()));

		const held = payload.services.find((s) => s.jobId === JOB_ID);
		const settled = payload.services.find((s) => s.jobId === SETTLED_JOB_ID);
		expect(held?.heldMicroUsd).toBe(1_200_000);
		expect(settled).toBeDefined();
		expect(settled).not.toHaveProperty("heldMicroUsd");
	});

	it("lists the conversation's sub-agent runs without their calls or summary, and its sources", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const other = await createTestConversation(locals);
		const run = startAgentRun({
			conversationId: conv._id,
			label: "research",
			displayName: "Research",
			task: `Context: the user wants X\n\nResearch task: ${"find a recipe ".repeat(20)}`,
			parent: { tool: "research", toolUuid: "tool-1", messageId: "msg-1" },
		});
		run.round(1, [{ tool: "hf_fs", args: "{}", status: "success" }]);
		await recordSources(conv._id, run.id, [
			{
				url: "https://huggingface.co/papers/2502.16161",
				group: "Hugging Face papers",
				kind: "paper",
				title: "OmniParser V2",
				opened: true,
			},
		]);
		await run.finish({ status: "completed", summary: "found it", iterations: 1 });
		await recordSources(other._id, PARENT_READER, [
			{ url: "https://example.com", group: "example.com", kind: "web", opened: true },
		]);

		const payload = await parseResponse(await get(locals, conv._id.toString()));

		expect(payload.agentRuns).toHaveLength(1);
		const [listed] = payload.agentRuns ?? [];
		expect(listed).toMatchObject({
			id: run.id,
			label: "research",
			displayName: "Research",
			parent: { tool: "research", toolUuid: "tool-1", messageId: "msg-1" },
			status: "completed",
			iterations: 1,
			callCount: 1,
			sourceCount: 1,
		});
		expect(listed.taskPreview.startsWith("Research task: find a recipe")).toBe(true);
		expect(listed.taskPreview.length).toBeLessThanOrEqual(161);
		for (const heavy of ["calls", "summary", "task", "_id", "conversationId"]) {
			expect(listed).not.toHaveProperty(heavy);
		}

		expect(payload.sources).toEqual([
			{
				id: expect.any(String),
				url: "https://huggingface.co/papers/2502.16161",
				group: "Hugging Face papers",
				kind: "paper",
				title: "OmniParser V2",
				opened: true,
				readBy: [run.id],
				count: 1,
				firstSeenAt: expect.any(Date),
				lastSeenAt: expect.any(Date),
			},
		]);
	});
});

describe.sequential("GET /api/v2/conversations/[id]/runs/[runId]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	const getRun = async (locals: App.Locals, id: string, runId: string) =>
		GET_RUN({ locals, params: { id, runId } } as never);

	it("returns one run with its task, summary and calls", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const run = startAgentRun({
			conversationId: conv._id,
			label: "sandbox",
			displayName: "Sandbox",
			task: "Sandbox handle: hfsb2:pngwn:abc\n\nTask: run the tests",
			parent: { tool: "sandbox_task", toolUuid: "tool-2" },
		});
		run.round(1, [
			{ tool: "hf_sandbox_exec", args: '{"cmd":"exec"}', status: "error", error: "boom" },
		]);
		await run.finish({ status: "completed", summary: "tests pass", iterations: 2 });

		const res = await getRun(locals, conv._id.toString(), run.id);
		const detail = superjson.parse(await res.text()) as MlAgentRunDetail;

		expect(detail).toMatchObject({
			id: run.id,
			task: "Sandbox handle: hfsb2:pngwn:abc\n\nTask: run the tests",
			summary: "tests pass",
			calls: [{ tool: "hf_sandbox_exec", args: '{"cmd":"exec"}', status: "error", error: "boom" }],
			status: "completed",
			iterations: 2,
		});
		expect(detail).not.toHaveProperty("conversationId");
	});

	it("404s for a run of another conversation, a malformed id and a share id", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		const other = await createTestConversation(locals);
		const run = startAgentRun({
			conversationId: other._id,
			label: "research",
			displayName: "Research",
			task: "t",
			parent: { tool: "research", toolUuid: "tool-3" },
		});
		await run.finish({ status: "aborted", iterations: 0 });

		await expectStatus(getRun(locals, conv._id.toString(), run.id), 404);
		await expectStatus(getRun(locals, conv._id.toString(), "not-an-id"), 404);
		await expectStatus(getRun(locals, "abcdefg", run.id), 404);
	});

	it("403s for another user's conversation", async () => {
		const { locals: owner } = await createTestUser();
		const { locals: intruder } = await createTestUser();
		const conv = await createTestConversation(owner);
		const run = startAgentRun({
			conversationId: conv._id,
			label: "research",
			displayName: "Research",
			task: "t",
			parent: { tool: "research", toolUuid: "tool-4" },
		});
		await run.finish({ status: "aborted", iterations: 0 });

		await expectStatus(getRun(intruder, conv._id.toString(), run.id), 403);
	});
});
