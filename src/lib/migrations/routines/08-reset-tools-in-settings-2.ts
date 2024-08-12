import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

const resetTools2: Migration = {
	_id: new ObjectId("000000000008"),
	name: "Reset tools to empty",
	up: async () => {
		const { settings } = collections;

		await settings.updateMany({}, { $set: { tools: [] } });

		return true;
	},
	runEveryTime: false,
	runForHuggingChat: "only",
};

export default resetTools2;
