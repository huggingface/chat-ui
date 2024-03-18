import type { Assistant } from "$lib/types/Assistant";
import type { Migration } from ".";
import { getCollections } from "$lib/server/database";
import { ObjectId, type AnyBulkWriteOperation } from "mongodb";

const migration: Migration = {
	_id: new ObjectId("65f7ff14298f30c5060eb6ac"),
	name: "Refresh assistants count for last 24 hours",
	up: async (client) => {
		const { assistants } = getCollections(client);
		const hourExpired = (new Date().getUTCHours() + 1).toString();
		let ops: AnyBulkWriteOperation<Assistant>[] = [];

		for await (const assistant of assistants
			.find({
				"last24HoursCount.count": { $gt: 0 },
			})
			.project<Pick<Assistant, "_id" | "last24HoursCount">>({ _id: 1, last24HoursCount: 1 })) {
			const decrementValue = assistant.last24HoursCount?.byHour?.[hourExpired] ?? 0;
			ops.push({
				updateOne: {
					filter: {
						_id: assistant._id,
					},
					update: {
						$inc: { "last24HoursCount.count": -decrementValue },
						$set: {
							[`last24HoursCount.byHour.${hourExpired}`]: 0,
						},
					},
				},
			});

			if (ops.length >= 1000) {
				await assistants.bulkWrite(ops, { ordered: false });
				ops = [];
			}
		}

		if (ops.length) {
			await assistants.bulkWrite(ops, { ordered: false });
		}

		return true;
	},
};

export default migration;
