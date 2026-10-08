import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { BSON, ObjectId } from "mongodb";
import { collections, ready } from "$lib/server/database";
import {
	cleanupTestData,
	createTestConversation,
	createTestUser,
} from "$lib/server/api/__tests__/testHelpers";
import { createConversationFromShare } from "$lib/server/conversation";
import { messageForStorage } from "$lib/server/generation/compressUpdates";
import type { Message } from "$lib/types/Message";
import { MessageToolUpdateType, MessageUpdateType } from "$lib/types/MessageUpdate";
import { ToolResultStatus } from "$lib/types/Tool";
import { offloadStoredToolImages, storeToolImage } from "./toolImages";
import { GET } from "../../../routes/conversation/[id]/output/[sha256]/+server";

beforeAll(async () => {
	await ready;
});

const inline = (bytes: Buffer, mimeType = "image/jpeg") => ({
	type: "image" as const,
	data: bytes.toString("base64"),
	mimeType,
});
const shaOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const attachResult = (
	uuid: string,
	images: unknown[]
): NonNullable<Message["updates"]>[number] => ({
	type: MessageUpdateType.Tool,
	subtype: MessageToolUpdateType.Result,
	uuid,
	result: {
		status: ToolResultStatus.Success,
		call: { name: "hf_fs", parameters: {} },
		outputs: [{ text: `attached ${images.length} file(s)`, content: images }],
		display: true,
	},
});

const assistant = (updates: Message["updates"]): Message => ({
	id: crypto.randomUUID(),
	from: "assistant",
	content: "",
	updates,
	createdAt: new Date(),
	updatedAt: new Date(),
});

const filesOf = (conversationId: ObjectId | string) =>
	collections.bucket.find({ filename: { $regex: `^${conversationId}-` } }).toArray();

describe.sequential("tool result images in GridFS", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanupTestData();
	});

	it("stores an image once per conversation however often it is attached", async () => {
		const conversationId = new ObjectId();
		const bytes = randomBytes(1024);

		const refs = await Promise.all([
			storeToolImage(conversationId, inline(bytes)),
			storeToolImage(conversationId, inline(bytes)),
		]);
		await storeToolImage(conversationId, inline(bytes));
		await storeToolImage(new ObjectId(), inline(bytes));

		expect(refs).toEqual([
			{ type: "image", mimeType: "image/jpeg", sha: shaOf(bytes) },
			{ type: "image", mimeType: "image/jpeg", sha: shaOf(bytes) },
		]);
		const files = await filesOf(conversationId);
		expect(files.map((f) => f.filename)).toEqual([`${conversationId}-${shaOf(bytes)}`]);
		expect(files[0].metadata).toEqual({
			conversation: conversationId.toString(),
			mime: "image/jpeg",
		});
	});

	it("moves stored inline images out of the messages and leaves refs and text alone", async () => {
		const conversationId = new ObjectId();
		const sheet = randomBytes(512);
		const ref = { type: "image", mimeType: "image/png", sha: "ab".repeat(32) };
		const messages = [
			assistant([
				attachResult("a", [inline(sheet), inline(randomBytes(512))]),
				attachResult("b", [ref]),
				attachResult("c", [inline(sheet), { type: "text", text: "kept" }]),
			]),
		];

		expect(await offloadStoredToolImages(conversationId, messages)).toBe(2);
		expect(JSON.stringify(messages)).not.toContain('"data"');
		const [, , c] = messages[0].updates ?? [];
		expect(c).toMatchObject({
			result: {
				outputs: [
					{
						text: "attached 2 file(s)",
						content: [
							{ type: "image", mimeType: "image/jpeg", sha: shaOf(sheet) },
							{ type: "text", text: "kept" },
						],
					},
				],
			},
		});
		expect(messages[0].updates?.[1]).toEqual(attachResult("b", [ref]));
		expect(await filesOf(conversationId)).toHaveLength(2);
		expect(await offloadStoredToolImages(conversationId, messages)).toBe(0);
	});

	it("keeps an image inline when its upload fails", async () => {
		const conversationId = new ObjectId();
		const image = inline(randomBytes(64));
		const messages = [assistant([attachResult("a", [image])])];
		vi.spyOn(collections.bucket, "openUploadStream").mockImplementation(() => {
			throw new Error("gridfs down");
		});

		expect(await offloadStoredToolImages(conversationId, messages)).toBe(0);
		expect(messages[0].updates?.[0]).toEqual(attachResult("a", [image]));
	});

	it("brings a conversation shaped like the 16 MiB export back well under the cap", async () => {
		const sheets = Array.from({ length: 26 }, () => randomBytes(215_000));
		const results = Array.from({ length: 22 }, (_, i) =>
			attachResult(`r${i}`, [inline(sheets[i % 26]), inline(sheets[(i * 7 + 3) % 26])])
		);
		const messages = [assistant(results)];
		const conversationId = new ObjectId();
		const before = BSON.calculateObjectSize({ messages: messages.map(messageForStorage) });

		await offloadStoredToolImages(conversationId, messages);

		const after = BSON.calculateObjectSize({ messages: messages.map(messageForStorage) });
		expect(before).toBeGreaterThan(12_500_000);
		expect(after).toBeLessThan(20_000);
		expect(await filesOf(conversationId)).toHaveLength(
			new Set(results.flatMap((_, i) => [i % 26, (i * 7 + 3) % 26])).size
		);
	}, 60_000);

	describe("served by the output route", () => {
		const fetchImage = (id: string, sha: string, locals: App.Locals) =>
			GET({ params: { id, sha256: sha }, locals } as never);

		it("serves the bytes to the owner, under the stored mime type", async () => {
			const { locals } = await createTestUser();
			const conv = await createTestConversation(locals);
			const bytes = randomBytes(300);
			const { sha } = await storeToolImage(conv._id, inline(bytes, "image/png"));

			const res = await fetchImage(conv._id.toString(), sha, locals);

			expect(res.headers.get("Content-Type")).toBe("image/png");
			expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
		});

		it("serves a share, and a conversation imported from it, the images the share copied", async () => {
			const { locals } = await createTestUser();
			const bytes = randomBytes(300);
			const shareId = "abc1234";
			const ref = await storeToolImage(shareId, inline(bytes));
			await collections.sharedConversations.insertOne({
				_id: shareId,
				hash: "h",
				title: "shared",
				model: "test-model",
				rootMessageId: undefined,
				messages: [assistant([attachResult("a", [ref])])],
				createdAt: new Date(),
				updatedAt: new Date(),
			} as never);

			const shared = await fetchImage(shareId, ref.sha, locals);
			expect(Buffer.from(await shared.arrayBuffer()).equals(bytes)).toBe(true);

			const imported = await createConversationFromShare(shareId, locals);
			const copy = await fetchImage(imported, ref.sha, locals);
			expect(Buffer.from(await copy.arrayBuffer()).equals(bytes)).toBe(true);
		});
	});
});
