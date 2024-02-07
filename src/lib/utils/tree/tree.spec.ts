import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import { ObjectId } from "mongodb";

const insertLegacyConversation = async () => {
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

const insertLinearBranchConversation = async () => {
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
				parent: null,
			},
			{
				id: "1-1-1-1-2",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
				parent: "1-1-1-1-1",
				ancestors: ["1-1-1-1-1"],
			},
			{
				id: "1-1-1-1-3",
				from: "user",
				content: "Hello, world! I am a user.",
				parent: "1-1-1-1-2",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2"],
			},
			{
				id: "1-1-1-1-4",
				from: "assistant",
				content: "Hello, world! I am an assistant.",
				parent: "1-1-1-1-3",
				ancestors: ["1-1-1-1-1", "1-1-1-1-2", "1-1-1-1-3"],
			},
		],
	});
	return res.insertedId;
};

// // new style of conversations where the messages store reference to their parents and ancestors
// const conversationWithLinearBranch = {
// 	_id: new ObjectId(),
// } satisfies Pick<Conversation, "_id" | "messages" | "rootMessageId">;

// const conversationWithSideBranches = {
// 	_id: new ObjectId(),
// 	rootMessageId: "1-1-1-1-1",
// 	messages: [
// 		{
// 			id: "1-1-1-1-1",
// 			from: "user",
// 			content: "Hello, world, root message!",
// 			ancestors: [],
// 			parent: null,
// 		},
// 		{
// 			id: "1-1-1-1-2",
// 			from: "assistant",
// 			content: "Hello, response to root message!",
// 			parent: "1-1-1-1-1",
// 			ancestors: ["1-1-1-1-1"],
// 		},
// 		{
// 			id: "1-1-1-1-3",
// 			from: "user",
// 			content: "Hello, follow up question!",
// 			parent: "1-1-1-1-2",
// 			ancestors: ["1-1-1-1-1", "1-1-1-1-2"],
// 		},
// 		{
// 			id: "1-1-1-1-4",
// 			from: "assistant",
// 			content: "Hello, response from follow up question!",
// 			parent: "1-1-1-1-3",
// 			ancestors: ["1-1-1-1-1", "1-1-1-1-2", "1-1-1-1-3"],
// 		},
// 		{
// 			id: "1-1-1-1-5",
// 			from: "assistant",
// 			content: "Hello, alternative assistant answer!",
// 			parent: "1-1-1-1-1",
// 			ancestors: ["1-1-1-1-1"],
// 		},
// 		{
// 			id: "1-1-1-1-6",
// 			from: "user",
// 			content: "Hello, follow up question to alternative answer!",
// 			parent: "1-1-1-1-5",
// 			ancestors: ["1-1-1-1-1", "1-1-1-1-5"],
// 		},
// 		{
// 			id: "1-1-1-1-7",
// 			from: "user",
// 			content: "Hello, alternative follow up question to alternative answer!",
// 			parent: "1-1-1-1-5",
// 			ancestors: ["1-1-1-1-1", "1-1-1-1-5"],
// 		},
// 	],
// } satisfies Pick<Conversation, "_id" | "messages" | "rootMessageId">;
