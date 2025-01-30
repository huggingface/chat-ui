import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId, type WithId } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
import type { Message } from "$lib/types/Message";

const renameMessageFromToRole: Migration = {
	_id: new ObjectId("000000000000000000000010"),
	name: "Rename message.from to message.role",
	up: async () => {
		const allConversations = collections.conversations.find({});

		let conversation: WithId<Pick<Conversation, "messages">> | null = null;
		while ((conversation = await allConversations.tryNext())) {
			const messages = conversation.messages.map((message) => {
				const { from, ...rest } = message as Message & { from: string };
				return { ...rest, role: from };
			}) as Message[];

			await collections.conversations.updateOne({ _id: conversation._id }, { $set: { messages } });
		}

		return true;
	},
	runEveryTime: false,
};

export default renameMessageFromToRole;
