import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Conversation } from "$lib/types/Conversation";
import { generateSearchTokens } from "$lib/utils/searchTokens";

const migration: Migration = {
	_id: new ObjectId("000000000011000000000001"),
	name: "Update search conversations",
	up: async () => {
		const { conversations } = collections;
		let ops: AnyBulkWriteOperation<Conversation>[] = [];

		for await (const conversation of conversations
			.find()
			.project<Pick<Conversation, "_id" | "title">>({ _id: 1, title: 1 })) {
			ops.push({
				updateOne: {
					filter: {
						_id: conversation._id,
					},
					update: {
						$set: {
							searchTokens: generateSearchTokens(conversation.title),
						},
					},
				},
			});

			if (ops.length >= 1000) {
				process.stdout.write(".");
				await conversations.bulkWrite(ops, { ordered: false });
				ops = [];
			}
		}

		if (ops.length) {
			await conversations.bulkWrite(ops, { ordered: false });
		}

		return true;
	},
	down: async () => {
		const { conversations } = collections;
		await conversations.updateMany({}, { $unset: { searchTokens: "" } });
		return true;
	},
};

export default migration;
