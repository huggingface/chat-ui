import { Database } from "$lib/server/database";
import { acquireLock, refreshLock } from "$lib/migrations/lock";
import type { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import { logger } from "$lib/server/logger";
import { collections } from "$lib/server/database";
import { Semaphores } from "$lib/types/Semaphore";
let hasLock = false;
let lockId: ObjectId | null = null;

async function getLastComputationTime(): Promise<Date> {
	const lastStats = await collections.assistantStats.findOne({}, { sort: { "date.at": -1 } });
	return lastStats?.date?.at || new Date(0);
}

async function shouldComputeStats(): Promise<boolean> {
	const lastComputationTime = await getLastComputationTime();
	const oneDayAgo = new Date(Date.now() - 24 * 3_600_000);
	return lastComputationTime < oneDayAgo;
}

async function refreshAssistantsCountsHelper() {
	if (!hasLock) {
		return;
	}

	try {
		await (await Database.getInstance()).getClient().withSession((session) =>
			session.withTransaction(async () => {
				await (
					await Database.getInstance()
				)
					.getCollections()
					.assistants.aggregate([
						{ $project: { _id: 1 } },
						{ $set: { last24HoursCount: 0 } },
						{
							$unionWith: {
								coll: "assistants.stats",
								pipeline: [
									{
										$match: { "date.at": { $gte: subDays(new Date(), 1) }, "date.span": "hour" },
									},
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
		logger.error(e, "Refresh assistants counter failed!");
	}
}

async function maintainLock() {
	if (hasLock && lockId) {
		hasLock = await refreshLock(Semaphores.ASSISTANTS_COUNT, lockId);

		if (!hasLock) {
			lockId = null;
		}
	} else if (!hasLock) {
		lockId = (await acquireLock(Semaphores.ASSISTANTS_COUNT)) || null;
		hasLock = !!lockId;
	}

	setTimeout(maintainLock, 10_000);
}

export function refreshAssistantsCounts() {
	const ONE_HOUR_MS = 3_600_000;

	maintainLock().then(async () => {
		if (await shouldComputeStats()) {
			refreshAssistantsCountsHelper();
		}

		setInterval(async () => {
			if (await shouldComputeStats()) {
				refreshAssistantsCountsHelper();
			}
		}, 24 * ONE_HOUR_MS);
	});
}
