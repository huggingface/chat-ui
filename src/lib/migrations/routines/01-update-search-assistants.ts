import type { Migration } from ".";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Assistant } from "$lib/types/Assistant";
import { generateSearchTokens } from "$lib/utils/searchTokens";
import { MongoDBClient } from "$lib/server/database";

const migration: Migration = {
	_id: new ObjectId("5f9f3e3e3e3e3e3e3e3e3e3e"),
	name: "Update search assistants",
	up: async () => {
		const { assistants } = MongoDBClient.collections;
		let ops: AnyBulkWriteOperation<Assistant>[] = [];

		for await (const assistant of assistants
			.find()
			.project<Pick<Assistant, "_id" | "name">>({ _id: 1, name: 1 })) {
			ops.push({
				updateOne: {
					filter: {
						_id: assistant._id,
					},
					update: {
						$set: {
							searchTokens: generateSearchTokens(assistant.name),
						},
					},
				},
			});

			if (ops.length >= 1000) {
				process.stdout.write(".");
				await assistants.bulkWrite(ops, { ordered: false });
				ops = [];
			}
		}

		if (ops.length) {
			await assistants.bulkWrite(ops, { ordered: false });
		}

		return true;
	},
	down: async () => {
		await MongoDBClient.collections.assistants.updateMany({}, { $unset: { searchTokens: "" } });
		return true;
	},
};

export default migration;
