import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";
import { ObjectId } from "mongodb";

function createRandomMessage(from: Message["from"]): Message {
	return {
		id: crypto.randomUUID(),
		from,
		content: `Hello, world! I am an {from}.`,
		branches: [],
	};
}

const legacyConversation = {
	_id: new ObjectId(),
	messages: [
		createRandomMessage("user"),
		createRandomMessage("assistant"),
		createRandomMessage("user"),
		createRandomMessage("assistant"),
	],
};

const conversationWithMainBranch = {
	_id: new ObjectId(),
	branches: [
		{
			_id: new ObjectId(),
			parents: [],
			messages: [
				createRandomMessage("user"),
				createRandomMessage("assistant"),
				createRandomMessage("user"),
				createRandomMessage("assistant"),
			],
		},
	],
};
