import type { Migration } from ".";
import { getCollections } from "$lib/server/database";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Assistant } from "$lib/types/Assistant";

const migration: Migration = {
	guid: "78c019ad-6bac-4958-a8ad-57a880e79bbf",
	name: "Update search assistants",
	up: async (client) => {
		const { assistants } = getCollections(client);
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
							searchTokens: assistant.name.split(" ").map((el) => el.toLowerCase()),
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
	down: async (client) => {
		const { assistants } = getCollections(client);
		await assistants.updateMany({}, { $unset: { searchTokens: "" } });
		return true;
	},
};

export default migration;
