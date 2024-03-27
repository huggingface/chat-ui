import { client, collections } from "$lib/server/database";
import { acquireLock, refreshLock } from "$lib/migrations/lock";
import type { ObjectId } from "mongodb";
import { subDays } from "date-fns";

const LOCK_KEY = "assistants.count";

let hasLock = false;
let lockId: ObjectId | null = null;

async function refreshAssistantsCountsHelper() {
	if (!hasLock) {
		return;
	}

	try {
		await client.withSession((session) =>
			session.withTransaction(async () => {
				await collections.assistants
					.aggregate([
						{ $project: { _id: 1 } },
						{ $set: { last24HoursCount: 0 } },
						{
							$unionWith: {
								coll: "assistants.stats",
								pipeline: [
									{ $match: { "date.at": { $gte: subDays(new Date(), 1) }, "date.span": "hour" } },
									{
										$group: {
											_id: "$assistantId",
											last24HoursCount: { $sum: "$count" },
										},
									},
								],
							},
						},
						{
							$group: {
								_id: "$_id",
								last24HoursCount: { $sum: "$last24HoursCount" },
							},
						},
						{
							$merge: {
								into: "assistants",
								on: "_id",
								whenMatched: "merge",
								whenNotMatched: "discard",
							},
						},
					])
					.next();
			})
		);
	} catch (e) {
		console.log("Refresh assistants counter failed!");
		console.error(e);
	}
}

async function maintainLock() {
	if (hasLock && lockId) {
		hasLock = await refreshLock(LOCK_KEY, lockId);

		if (!hasLock) {
			lockId = null;
		}
	} else if (!hasLock) {
		lockId = (await acquireLock(LOCK_KEY)) || null;
		hasLock = !!lockId;
	}

	setTimeout(maintainLock, 10_000);
}

export function refreshAssistantsCounts() {
	const ONE_HOUR_MS = 3_600_000;

	maintainLock().then(() => {
		refreshAssistantsCountsHelper();

		setInterval(refreshAssistantsCountsHelper, ONE_HOUR_MS);
	});
}
