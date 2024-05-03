import { Database } from "$lib/server/database";
import { migrations } from "./routines";
import { acquireLock, releaseLock, isDBLocked, refreshLock } from "./lock";
import { isHuggingChat } from "$lib/utils/isHuggingChat";
import { logger } from "$lib/server/logger";

const LOCK_KEY = "migrations";

export async function checkAndRunMigrations() {
	// make sure all GUIDs are unique
	if (new Set(migrations.map((m) => m._id.toString())).size !== migrations.length) {
		throw new Error("Duplicate migration GUIDs found.");
	}

	// check if all migrations have already been run
	const migrationResults = await Database.getInstance()
		.getCollections()
		.migrationResults.find()
		.toArray();

	logger.info("[MIGRATIONS] Begin check...");

	// connect to the database
	const connectedClient = await Database.getInstance().getClient().connect();

	const lockId = await acquireLock(LOCK_KEY);

	if (!lockId) {
		// another instance already has the lock, so we exit early
		logger.info(
			"[MIGRATIONS] Another instance already has the lock. Waiting for DB to be unlocked."
		);

		// Todo: is this necessary? Can we just return?
		// block until the lock is released
		while (await isDBLocked(LOCK_KEY)) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		return;
	}

	// once here, we have the lock
	// make sure to refresh it regularly while it's running
	const refreshInterval = setInterval(async () => {
		await refreshLock(LOCK_KEY, lockId);
	}, 1000 * 10);

	// iterate over all migrations
	for (const migration of migrations) {
		// check if the migration has already been applied
		const shouldRun =
			migration.runEveryTime ||
			!migrationResults.find((m) => m._id.toString() === migration._id.toString());

		// check if the migration has already been applied
		if (!shouldRun) {
			logger.info(`[MIGRATIONS] "${migration.name}" already applied. Skipping...`);
		} else {
			// check the modifiers to see if some cases match
			if (
				(migration.runForHuggingChat === "only" && !isHuggingChat) ||
				(migration.runForHuggingChat === "never" && isHuggingChat)
			) {
				logger.info(
					`[MIGRATIONS] "${migration.name}" should not be applied for this run. Skipping...`
				);
				continue;
			}

			// otherwise all is good and we can run the migration
			logger.info(
				`[MIGRATIONS] "${migration.name}" ${
					migration.runEveryTime ? "should run every time" : "not applied yet"
				}. Applying...`
			);

			await Database.getInstance()
				.getCollections()
				.migrationResults.updateOne(
					{ _id: migration._id },
					{
						$set: {
							name: migration.name,
							status: "ongoing",
						},
					},
					{ upsert: true }
				);

			const session = connectedClient.startSession();
			let result = false;

			try {
				await session.withTransaction(async () => {
					result = await migration.up(Database.getInstance());
				});
			} catch (e) {
				logger.info(`[MIGRATIONS]  "${migration.name}" failed!`);
				logger.error(e);
			} finally {
				await session.endSession();
			}

			await Database.getInstance()
				.getCollections()
				.migrationResults.updateOne(
					{ _id: migration._id },
					{
						$set: {
							name: migration.name,
							status: result ? "success" : "failure",
						},
					},
					{ upsert: true }
				);
		}
	}

	logger.info("[MIGRATIONS] All migrations applied. Releasing lock");

	clearInterval(refreshInterval);
	await releaseLock(LOCK_KEY, lockId);
}
