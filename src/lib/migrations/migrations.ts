import { client, collections, getCollections } from "$lib/server/database";
import { migrations } from "./routines";
import {
	acquireLock,
	createAndAcquireLock,
	releaseLock,
	isDBLocked,
	discardExpiredLock,
	refreshLock,
} from "./lock";
import { isHuggingChat } from "$lib/utils/isHuggingChat";

export async function checkAndRunMigrations() {
	// make sure all GUIDs are unique
	if (new Set(migrations.map((m) => m.guid)).size !== migrations.length) {
		throw new Error("Duplicate migration GUIDs found.");
	}

	console.log("[MIGRATIONS] Begin check...");

	// connect to the database
	const connectedClient = await client.connect();

	// see if semaphore needs to be created
	let hasLock = false;
	let isFresh = false;

	const createdLock = await createAndAcquireLock();

	if (createdLock) {
		console.log("[MIGRATIONS] Created lock. Fresh install detected.");
		// if the semaphore was created, we have the lock
		hasLock = true;
		isFresh = true;
	} else {
		// else we have to check if we can get a lock
		hasLock = await acquireLock();
		isFresh = false;
	}

	if (!hasLock) {
		// another instance already has the lock, so we exit early
		console.log(
			"[MIGRATIONS] Another instance already has the lock. Waiting for DB to be unlocked."
		);

		// block until the lock is released
		while (await isDBLocked()) {
			const discarded = await discardExpiredLock();
			if (discarded) {
				console.log("[MIGRATIONS] Discarded expired lock. Erroring out");
				throw new Error("Lock timed out while waiting for it to be released.");
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		return;
	}

	// once here, we have the lock
	// make sure to refresh it regularly while it's running
	const refreshInterval = setInterval(async () => {
		await refreshLock();
	}, 60 * 1000);

	// get all migration results that have already been applied
	const migrationResults = await collections.migrationResults.find().toArray();

	// iterate over all migrations
	for (const migration of migrations) {
		// check if the migration has already been applied
		const existingMigrationResult = migrationResults.find((m) => m.guid === migration.guid);

		// check if the migration has already been applied
		if (existingMigrationResult) {
			console.log(`[MIGRATIONS] "${migration.name}" already applied. Skipping...`);
		} else {
			// check the modifiers to see if some cases match
			if (
				(migration.runForFreshInstall === "only" && !isFresh) ||
				(migration.runForHuggingChat === "only" && !isHuggingChat) ||
				(migration.runForFreshInstall === "never" && isFresh) ||
				(migration.runForHuggingChat === "never" && isHuggingChat)
			) {
				console.log(
					`[MIGRATIONS] "${migration.name}" should not be applied for this run. Skipping...`
				);
				continue;
			}

			// otherwise all is good and we cna run the migration
			console.log(`[MIGRATIONS] "${migration.name}" not applied yet. Applying...`);

			await getCollections(connectedClient).migrationResults.updateOne(
				{ guid: migration.guid },
				{
					$set: {
						guid: migration.guid,
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
					result = await migration.up(connectedClient);
				});
			} catch (e) {
				console.log(`[MIGRATION[]  "${migration.name}" failed!`);
				console.error(e);
			} finally {
				await session.endSession();
			}

			await getCollections(connectedClient).migrationResults.updateOne(
				{ guid: migration.guid },
				{
					$set: {
						guid: migration.guid,
						name: migration.name,
						status: result ? "success" : "failure",
					},
				},
				{ upsert: true }
			);
		}
	}

	console.log("[MIGRATIONS] All migrations applied. Releasing lock");

	clearInterval(refreshInterval);
	releaseLock();
}
