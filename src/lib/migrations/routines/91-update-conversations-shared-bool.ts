import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

const updateConversationsSharedBool: Migration = {
	_id: new ObjectId("000000000091"),
	name: "Update all conversations without a shared field to have a shared field set to false",
	up: async () => {
		const result = await collections.conversations.updateMany(
			{ shared: { $exists: false } },
			{ $set: { shared: false } }
		);

		console.log(`Updated ${result.modifiedCount} conversations`);
		return true;
	},
	runEveryTime: false,
};

export default updateConversationsSharedBool;
