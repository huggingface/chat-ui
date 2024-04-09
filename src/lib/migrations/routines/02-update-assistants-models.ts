import type { Migration } from ".";
import { getCollections } from "$lib/server/database";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import type { Assistant } from "$lib/types/Assistant";
import { models } from "$lib/server/models";

const updateAssistantsModels: Migration = {
	_id: new ObjectId("5f9f3f3f3f3f3f3f3f3f3f3f"),
	name: "Update deprecated assistants models",
	up: async (client) => {
		const { assistants } = getCollections(client);

		const modelIds = models.map((el) => el.id); // string[]
		const defaultModelId = models[0].id;

		let ops: AnyBulkWriteOperation<Assistant>[] = [];

		// Find all assistants whose modelId is not in modelIds, and update it to use defaultModelId
		for await (const assistant of assistants.find({ modelId: { $nin: modelIds } })) {
			console.log({ assistant });
			ops.push({
				updateOne: {
					filter: { _id: assistant._id },
					update: { $set: { modelId: defaultModelId } },
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
	runEveryTime: true,
	runForHuggingChat: "only",
};

export default updateAssistantsModels;
