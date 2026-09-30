import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import { writeMlFileVersion } from "$lib/server/mlFiles/store";
import { cleanupTestData, createTestConversation, createTestUser } from "./testHelpers";

vi.mock("$lib/server/logger", () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
}));

const { DELETE: deleteOneV2 } =
	await import("../../../../routes/api/v2/conversations/[id]/+server");
const { DELETE: deleteAllV2 } = await import("../../../../routes/api/v2/conversations/+server");
const { DELETE: deleteAllLegacy } = await import("../../../../routes/api/conversations/+server");
const { DELETE: deleteOneLegacy } = await import("../../../../routes/conversation/[id]/+server");

beforeAll(async () => {
	await ready;
});

afterEach(async () => {
	await cleanupTestData();
});

async function seed(conversationId: ObjectId, name: string) {
	await writeMlFileVersion({ conversationId, name, content: "1", origin: "write" });
	await writeMlFileVersion({ conversationId, name, content: "2", origin: "edit" });
}

const filesOf = (conversationId: ObjectId) =>
	collections.mlFiles.countDocuments({ conversationId });

describe("deleting a conversation deletes its virtual files", () => {
	it("on the v2 single delete", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "mine" });
		const kept = await createTestConversation(locals, { title: "kept" });
		await seed(conv._id, "train.py");
		await seed(kept._id, "train.py");

		await deleteOneV2({ locals, params: { id: conv._id.toString() } } as never);

		expect(await filesOf(conv._id)).toBe(0);
		expect(await filesOf(kept._id)).toBe(2);
	});

	it("on the v2 bulk delete, for every conversation the user owns", async () => {
		const { locals } = await createTestUser();
		const { locals: otherLocals } = await createTestUser();
		const a = await createTestConversation(locals, { title: "a" });
		const b = await createTestConversation(locals, { title: "b" });
		const theirs = await createTestConversation(otherLocals, { title: "theirs" });
		await seed(a._id, "a.py");
		await seed(b._id, "b.py");
		await seed(theirs._id, "t.py");

		await deleteAllV2({ locals } as never);

		expect(await filesOf(a._id)).toBe(0);
		expect(await filesOf(b._id)).toBe(0);
		expect(await filesOf(theirs._id)).toBe(2);
	});

	it("on the legacy bulk delete", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "legacy" });
		await seed(conv._id, "train.py");

		await deleteAllLegacy({ locals } as never);

		expect(await collections.conversations.countDocuments({ _id: conv._id })).toBe(0);
		expect(await filesOf(conv._id)).toBe(0);
	});

	it("on the legacy single delete", async () => {
		const { locals } = await createTestUser();
		const conv = await createTestConversation(locals, { title: "legacy one" });
		await seed(conv._id, "train.py");

		await deleteOneLegacy({ locals, params: { id: conv._id.toString() } } as never);

		expect(await collections.conversations.countDocuments({ _id: conv._id })).toBe(0);
		expect(await filesOf(conv._id)).toBe(0);
	});
});
