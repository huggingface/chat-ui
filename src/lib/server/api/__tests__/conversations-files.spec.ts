import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import superjson from "superjson";
import { ready } from "$lib/server/database";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import type { MlFileVersionContent, MlFileVersions } from "$lib/types/MlFile";
import {
	cleanupTestData,
	createTestConversation,
	createTestLocals,
	createTestUser,
} from "./testHelpers";

import { GET } from "../../../../routes/api/v2/conversations/[id]/files/[...name]/+server";

async function parseResponse<T>(res: Response): Promise<T> {
	return superjson.parse(await res.text()) as T;
}

const get = async (locals: App.Locals, id: string, name: string, version?: string) => {
	const url = new URL(`http://localhost/api/v2/conversations/${id}/files/${name}`);
	if (version !== undefined) url.searchParams.set("version", version);
	return GET({ locals, params: { id, name }, url } as never);
};

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

describe.sequential("GET /api/v2/conversations/[id]/files/[...name]", () => {
	afterEach(async () => {
		await cleanupTestData();
	});

	async function withTrainPy() {
		const user = await createTestUser();
		const conv = await createTestConversation(user.locals);
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(1)\n",
			origin: "write",
			summary: "first cut",
			attribution: { messageId: "msg-1", generationId: "gen-1", toolUuid: "uuid-1" },
		});
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(2)\n",
			origin: "edit",
			attribution: { agent: "sandbox_task" },
		});
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "train.py",
			content: "print(3)\n",
			origin: "import",
			source: "hfsb2:pngwn:0123456789abcdef01234567:/work/train.py",
		});
		return { ...user, conv };
	}

	it("throws 401 without a session", async () => {
		const locals = createTestLocals({ sessionId: undefined, user: undefined });
		await expectStatus(get(locals, new ObjectId().toString(), "train.py"), 401);
	});

	it("throws 404 for a share id, whose reader is not the owner", async () => {
		const { locals } = await createTestUser();
		await expectStatus(get(locals, "abcdefg", "train.py"), 404);
	});

	it("throws 403 for another user's conversation", async () => {
		const { conv } = await withTrainPy();
		const { locals: other } = await createTestUser();
		await expectStatus(get(other, conv._id.toString(), "train.py"), 403);
		await expectStatus(get(other, conv._id.toString(), "train.py", "1"), 403);
	});

	it("throws 404 for a name the conversation has no file for", async () => {
		const { locals, conv } = await withTrainPy();
		const other = await createTestConversation(locals);
		await expectStatus(get(locals, conv._id.toString(), "eval.py"), 404);
		await expectStatus(get(locals, other._id.toString(), "train.py"), 404);
	});

	it("lists every version newest first, without content", async () => {
		const { locals, conv } = await withTrainPy();

		const res = await get(locals, conv._id.toString(), "train.py");

		expect(res.status).toBe(200);
		const payload = await parseResponse<MlFileVersions>(res);
		expect(payload.name).toBe("train.py");
		expect(payload.versions).toEqual([
			{
				version: 3,
				size: 9,
				origin: "import",
				source: "hfsb2:pngwn:0123456789abcdef01234567:/work/train.py",
				createdAt: expect.any(Date),
			},
			{ version: 2, size: 9, origin: "edit", agent: "sandbox_task", createdAt: expect.any(Date) },
			{
				version: 1,
				size: 9,
				origin: "write",
				summary: "first cut",
				messageId: "msg-1",
				createdAt: expect.any(Date),
			},
		]);
	});

	it("returns one version's content with its metadata", async () => {
		const { locals, conv } = await withTrainPy();

		const payload = await parseResponse<MlFileVersionContent>(
			await get(locals, conv._id.toString(), "train.py", "1")
		);

		expect(payload).toEqual({
			name: "train.py",
			version: 1,
			size: 9,
			origin: "write",
			summary: "first cut",
			messageId: "msg-1",
			createdAt: expect.any(Date),
			content: "print(1)\n",
		});
	});

	it("throws 404 for a version that does not exist and 400 for one that is not a number", async () => {
		const { locals, conv } = await withTrainPy();
		await expectStatus(get(locals, conv._id.toString(), "train.py", "4"), 404);
		await expectStatus(get(locals, conv._id.toString(), "train.py", "0"), 400);
		await expectStatus(get(locals, conv._id.toString(), "train.py", "latest"), 400);
	});

	it("reads a name with slashes in it", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals);
		await writeMlFileVersion({
			conversationId: conv._id,
			name: "configs/sft.yaml",
			content: "lr: 1e-4\n",
			origin: "write",
		});

		const listed = await parseResponse<MlFileVersions>(
			await get(locals, conv._id.toString(), "configs/sft.yaml")
		);
		const read = await parseResponse<MlFileVersionContent>(
			await get(locals, conv._id.toString(), "configs/sft.yaml", "1")
		);

		expect(listed.versions.map((v) => v.version)).toEqual([1]);
		expect(read).toMatchObject({ name: "configs/sft.yaml", content: "lr: 1e-4\n" });
		await expectStatus(get(locals, conv._id.toString(), "sft.yaml"), 404);
	});
});
