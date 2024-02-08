import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { insertLegacyConversation, insertSideBranchesConversation } from "./treeHelpers.spec";
import { getChildren } from "./getChildren";

describe("isLeaf", () => {
	it("a subtree in a legacy conversation should be just a slice", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		expect(getChildren(conv, conv.messages[0].id)[0].id).toEqual(conv.messages[1].id);
		expect(getChildren(conv, conv.messages[0].id).length).toEqual(1);

		expect(getChildren(conv, conv.messages[2].id)[0].id).toEqual(conv.messages[3].id);
		expect(getChildren(conv, conv.messages[2].id).length).toEqual(1);

		// check last
		const id2 = conv.messages[conv.messages.length - 1].id;
		expect(getChildren(conv, id2).length).toEqual(0);
	});

	it("should throw an error if the message is not found", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const id = "not-a-real-id-test";

		expect(() => getChildren(conv, id)).toThrow("Message not found");
	});

	it("should throw on empty conversations", () => {
		const conv = {
			_id: new ObjectId(),
			rootMessageId: undefined,
			messages: [],
		};

		expect(() => getChildren(conv, "not-a-real-id-test")).toThrow("Message not found");
	});

	it("should work for conversation with subtrees", async () => {
		const convId = await insertSideBranchesConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		expect(getChildren(conv, "1-1-1-1-1")).toEqual([conv.messages[1], conv.messages[4]]);

		expect(getChildren(conv, "1-1-1-1-2")).toEqual([conv.messages[2]]);

		expect(getChildren(conv, "1-1-1-1-3")).toEqual([conv.messages[3]]);

		expect(getChildren(conv, "1-1-1-1-4").length).toEqual(0);

		expect(getChildren(conv, "1-1-1-1-5")).toEqual([conv.messages[5], conv.messages[6]]);

		expect(getChildren(conv, "1-1-1-1-6").length).toEqual(0);
		expect(getChildren(conv, "1-1-1-1-7").length).toEqual(0);
	});
});
