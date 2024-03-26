import type { Migration } from "../migrations/routines";
import { client, collections, getCollections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import type { MigrationResult } from "$lib/types/MigrationResult";
import { acquireLock, isDBLocked, refreshLock, releaseLock } from "$lib/migrations/lock";

const migration: Migration = {
	_id: new ObjectId("65f7ff14298f30c5060eb6ac"),
	name: "Refresh assistants count for last 24 hours",
	// eslint-disable-next-line no-shadow
	up: async (client) => {
		const { assistantStats } = getCollections(client);
		const currentDate = new Date();
		const twentyFourHoursAgo = new Date();
		twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1); // subtract 24 hours (i.e. 1 day)

		assistantStats.aggregate([
			{ $match: { dateDay: { $gte: twentyFourHoursAgo, $lt: currentDate } } },
			{
				$group: {
					_id: { _id: "$_id", dateWithHour: "$dateWithHour" },
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

		return true;
	},
};

async function refreshAssistantsCountsHelper() {
	const hourExpired = new Date().getUTCHours() + 1;

	const migrationResult = await collections.migrationResults.findOne<MigrationResult<number>>({
		_id: migration._id,
	});
	if (migrationResult?.data === hourExpired) {
		// another instance already run the migration, so we exit early
		return;
	}

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

	await collections.migrationResults.updateOne(
		{ _id: migration._id },
		{
			$set: {
				name: migration.name,
				status: "ongoing",
			},
		},
		{ upsert: true }
	);

	const session = client.startSession();
	let result = false;

	try {
		await session.withTransaction(async () => {
			result = await migration.up(client);
		});
	} catch (e) {
		console.log(`"${migration.name}" failed!`);
		console.error(e);
	} finally {
		await session.endSession();
	}

	await collections.migrationResults.updateOne(
		{ _id: migration._id },
		{
			$set: {
				name: migration.name,
				status: result ? "success" : "failure",
				data: hourExpired,
			},
		},
		{ upsert: true }
	);

	clearInterval(refreshInterval);
	await releaseLock(lockKey);
}

export function refreshAssistantsCounts() {
	const ONE_HOUR_MS = 3_600_000;
	setInterval(refreshAssistantsCountsHelper, ONE_HOUR_MS);
}
