import { client, collections } from "$lib/server/database";
import { acquireLock, isDBLocked, refreshLock, releaseLock } from "$lib/migrations/lock";
import { addHours, startOfHour } from "date-fns";

async function refreshAssistantsCountsHelper() {
	const lockKey = "assistants.count";
	const hasLock = await acquireLock(lockKey);

	if (!hasLock) {
		// block until the lock is released
		while (await isDBLocked(lockKey)) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		// another instance already has the lock, so we exit early
		return;
	}

	// once here, we have the lock
	// make sure to refresh it regularly while it's running
	const refreshInterval = setInterval(async () => {
		await refreshLock(lockKey);
	}, 1000 * 10);

	const session = client.startSession();

	try {
		await session.withTransaction(async () => {
			const { assistantStats } = collections;
			const currentDate = new Date();
			const twentyFourHoursAgo = new Date();
			twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1); // subtract 24 hours (i.e. 1 day)

			assistantStats.aggregate([
				{ $match: { dateDay: { $gte: twentyFourHoursAgo, $lt: currentDate } } },
				{
					$group: {
						_id: { _id: "$_id" },
						totalCount: { $sum: "$count" },
					},
				},
				{
					$merge: {
						into: "assistants",
						on: "_id",
						whenMatched: [
							{
								$set: {
									"last24HoursCount.count": "$$ROOT.totalCount",
									"last24HoursCount.lastUpdated": new Date(),
								},
							},
						],
						whenNotMatched: "discard",
					},
				},
			]);
		});
	} catch (e) {
		console.log("Refresh assistants counter failed!");
		console.error(e);
	} finally {
		await session.endSession();
	}

	clearInterval(refreshInterval);
	await releaseLock(lockKey);
}

export function refreshAssistantsCounts() {
	const now = new Date();
	const nextHour = startOfHour(addHours(now, 1));
	const delay = nextHour.getTime() - now.getTime();

	const ONE_HOUR_MS = 3_600_000;

	// wait until the next hour to start the hourly interval
	setTimeout(() => {
		refreshAssistantsCountsHelper();
		setInterval(refreshAssistantsCountsHelper, ONE_HOUR_MS);
	}, delay);
}
