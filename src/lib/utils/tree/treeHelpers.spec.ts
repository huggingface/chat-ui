import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it } from "vitest";

export const insertLegacyConversation = async () => {
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		title: "legacy conversation",
		model: "",
		embeddingModel: "",
		messages: [
			{
				id: "1-1-1-1-1",
				from: "user",
				content: "Hello, world! I am a user.",
			},
			{
				id: "1-1-1-1-2",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
			},
			{
				id: "1-1-1-1-3",
				from: "user",
				content: "Hello, world! I am a user.",
			},
			{
				id: "1-1-1-1-4",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
			},
		],
	});
	return res.insertedId;
};

export const insertLinearBranchConversation = async () => {
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		title: "linear branch conversation",
		model: "",
		embeddingModel: "",

		rootMessageId: "1-1-1-1-1",
		messages: [
			{
				id: "1-1-1-1-1",
				from: "user",
				content: "Hello, world! I am a user",
				ancestors: [],
			},
			{
				id: "1-1-1-1-2",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
				ancestors: ["1-1-1-1-1"],
			},
			{
				id: "1-1-1-1-3",
				from: "user",
				content: "Hello, world! I am a user.",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2"],
			},
			{
				id: "1-1-1-1-4",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2", "1-1-1-1-3"],
			},
		],
	});
	return res.insertedId;
};

export const insertSideBranchesConversation = async () => {
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		createdAt: new Date(),
		updatedAt: new Date(),
		title: "side branches conversation",
		model: "",
		embeddingModel: "",
		rootMessageId: "1-1-1-1-1",
		messages: [
			{
				id: "1-1-1-1-1",
				from: "user",
				content: "Hello, world, root message!",
				ancestors: [],
			},
			{
				id: "1-1-1-1-2",
				from: "assistant",
				content: "Hello, response to root message!",
				ancestors: ["1-1-1-1-1"],
			},
			{
				id: "1-1-1-1-3",
				from: "user",
				content: "Hello, follow up question!",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2"],
			},
			{
				id: "1-1-1-1-4",
				from: "assistant",
				content: "Hello, response from follow up question!",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2", "1-1-1-1-3"],
			},
			{
				id: "1-1-1-1-5",
				from: "assistant",
				content: "Hello, alternative assistant answer!",
				ancestors: ["1-1-1-1-1"],
			},
			{
				id: "1-1-1-1-6",
				from: "user",
				content: "Hello, follow up question to alternative answer!",
				ancestors: ["1-1-1-1-1", "1-1-1-1-5"],
			},
			{
				id: "1-1-1-1-7",
				from: "user",
				content: "Hello, alternative follow up question to alternative answer!",
				ancestors: ["1-1-1-1-1", "1-1-1-1-5"],
			},
		],
	});
	return res.insertedId;
};

describe("inserting conversations", () => {
	it("should insert a legacy conversation", async () => {
		await insertLegacyConversation();
		const conversationCount = await collections.conversations.countDocuments({
			title: "legacy conversation",
		});
		expect(conversationCount).toBe(1);
	});

	it("should insert a linear branch conversation", async () => {
		await insertLinearBranchConversation();
		const conversationCount = await collections.conversations.countDocuments({
			title: "linear branch conversation",
		});
		expect(conversationCount).toBe(1);
	});

	it("should insert a side branches conversation", async () => {
		await insertSideBranchesConversation();
		const conversationCount = await collections.conversations.countDocuments({
			title: "side branches conversation",
		});
		expect(conversationCount).toBe(1);
	});
});

afterEach(async () => {
	await collections.conversations.deleteMany({});
});
