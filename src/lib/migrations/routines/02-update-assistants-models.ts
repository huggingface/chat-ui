import type { Migration } from ".";
import { getCollections } from "$lib/server/database";
import { ObjectId } from "mongodb";

const updateAssistantsModels: Migration = {
	_id: new ObjectId("5f9f3f3f3f3f3f3f3f3f3f3f"),
	name: "Update deprecated models in assistants with the default model",
	up: async (client) => {
		const models = (await import("$lib/server/models")).models;

		const { assistants } = getCollections(client);

		const modelIds = models.map((el) => el.id); // string[]
		const defaultModelId = models[0].id;

		// Find all assistants whose modelId is not in modelIds, and update it to use defaultModelId
		await assistants.updateMany(
			{ modelId: { $nin: modelIds } },
			{ $set: { modelId: defaultModelId } }
		);

		return true;
	},
	runEveryTime: true,
	runForHuggingChat: "only",
};

export default updateAssistantsModels;
