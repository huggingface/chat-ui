import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import superjson from "superjson";
import { ready } from "$lib/server/database";
import { recordArtefact, recordDispatchedService } from "$lib/server/mlRegistry/store";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MlRegistryPayload } from "$lib/types/MlRegistry";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "./testHelpers";

import { GET } from "../../../../routes/api/v2/conversations/[id]/registry/+server";

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
});
