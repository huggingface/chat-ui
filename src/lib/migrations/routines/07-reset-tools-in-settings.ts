import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { toolFromConfigs } from "$lib/server/tools";

const resetTools: Migration = {
	_id: new ObjectId("000000000007"),
	name: "Set tools to default",
	up: async () => {
		const { settings } = collections;

		const defaultToolIds = toolFromConfigs
			.filter((el) => el.isOnByDefault && !el.isHidden)
			.map((el) => el._id.toString());

		await settings.updateMany({}, { $set: { tools: defaultToolIds } });

		return true;
	},
	runEveryTime: false,
	runForHuggingChat: "only",
};

export default resetTools;
