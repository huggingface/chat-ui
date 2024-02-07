import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";

import { convertLegacyConversation } from "./convertLegacyConversation";
import { insertLegacyConversation, insertLinearBranchConversation } from "./treeHelpers.spec";

describe("convertLegacyConversation", () => {
	it("should convert a legacy conversation", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newConv = convertLegacyConversation(conv);
		expect(newConv.rootMessageId).toBe(newConv.messages[0].id);
		expect(newConv.messages[0].ancestors).toEqual([]);

		// insert a conversation which should be equivalent to newConv
		const linearBranchConvId = await insertLinearBranchConversation();
		const linearBranchConv = await collections.conversations.findOne({
			_id: new ObjectId(linearBranchConvId),
		});
		if (!linearBranchConv) throw new Error("Conversation not found");

		// compare the two, linearBranchConv messages and rootMessageId should be equivalent to newConv
		expect(linearBranchConv.rootMessageId).toEqual(newConv.rootMessageId);
		expect(linearBranchConv.messages).toEqual(newConv.messages);
	});
	it("should work on empty conversations", async () => {
		const conv = {
			_id: new ObjectId(),
			rootMessageId: undefined,
			messages: [],
		};
		const newConv = convertLegacyConversation(conv);
		expect(newConv.rootMessageId).toBe(undefined);
		expect(newConv.messages).toEqual([]);
	});
});

afterEach(async () => {
	await collections.conversations.deleteMany({});
});
