import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { insertLegacyConversation, insertSideBranchesConversation } from "./treeHelpers.spec";
import { addChildren } from "./addChildren";
import type { Message } from "$lib/types/Message";
import { getChildren } from "./getChildren";

describe("addChildren", async () => {
	it("should let you append on legacy conversations", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		const convLength = conv.messages.length;

		addChildren(conv, newMessage, conv.messages[conv.messages.length - 1].id);
		expect(conv.messages.length).toEqual(convLength + 1);
	});
	it("should not let you create branches on legacy conversations", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		expect(() => addChildren(conv, newMessage, conv.messages[0].id)).toThrow();
	});
	it("should not let you create a message that already exists", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: conv.messages[0].id,
			content: "new message",
			from: "user",
		};

		expect(() => addChildren(conv, newMessage, conv.messages[0].id)).toThrow();
	});
	it("should let you create branches on conversations with subtrees", async () => {
		const convId = await insertSideBranchesConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		const parentId = conv.messages[0].id;
		const nChildren = getChildren(conv, parentId).length;

		addChildren(conv, newMessage, parentId);
		expect(getChildren(conv, parentId).length).toEqual(nChildren + 1);
	});
	it("should let you create a new leaf", async () => {
		const convId = await insertSideBranchesConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		const parentId = conv.messages[conv.messages.length - 1].id;
		const nChildren = getChildren(conv, parentId).length;

		expect(nChildren).toEqual(0);

		addChildren(conv, newMessage, parentId);
		expect(getChildren(conv, parentId).length).toEqual(nChildren + 1);
	});
	it("should let you append to an empty conversation without specifying a parentId", async () => {
		const conv = {
			_id: new ObjectId(),
			rootMessageId: undefined,
			messages: [],
		};

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		addChildren(conv, newMessage);
		expect(conv.messages.length).toEqual(1);
		expect(conv.rootMessageId).toEqual(newMessage.id);
	});

	it("should throw if you don't specify a parentId in a conversation with messages", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		expect(() => addChildren(conv, newMessage)).toThrow();
	});
	it("should return the id of the new message", async () => {
		const convId = await insertLegacyConversation();
		const conv = await collections.conversations.findOne({ _id: new ObjectId(convId) });
		if (!conv) throw new Error("Conversation not found");

		const newMessage: Message = {
			id: "2-2-2-2-2",
			content: "new message",
			from: "user",
		};

		expect(addChildren(conv, newMessage, conv.messages[conv.messages.length - 1].id)).toEqual(
			newMessage.id
		);
	});
});
