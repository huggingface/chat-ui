import { client, collections } from "$lib/server/database";
import { migrations } from "./routines";
import { acquireLock, releaseLock, isDBLocked, refreshLock } from "./lock";
import { isHuggingChat } from "$lib/utils/isHuggingChat";
import assistantsCountMigration from "./routines/refresh-assistants-counts";
import type { MigrationResult } from "$lib/types/MigrationResult";

export async function checkAndRunMigrations() {
	// make sure all GUIDs are unique
	if (new Set(migrations.map((m) => m._id.toString())).size !== migrations.length) {
		throw new Error("Duplicate migration GUIDs found.");
	}

	// check if all migrations have already been run
	const migrationResults = await collections.migrationResults.find().toArray();

	// if all the migrations._id are in the migrationResults, we can exit early
	if (
		migrations.every((m) => migrationResults.some((m2) => m2._id.toString() === m._id.toString()))
	) {
		console.log("[MIGRATIONS] All migrations already applied.");
		return;
	}

	console.log("[MIGRATIONS] Begin check...");

	// connect to the database
	const connectedClient = await client.connect();

	const hasLock = await acquireLock();

	if (!hasLock) {
		// another instance already has the lock, so we exit early
		console.log(
			"[MIGRATIONS] Another instance already has the lock. Waiting for DB to be unlocked."
		);

		// block until the lock is released
		while (await isDBLocked()) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		return;
	}

	// once here, we have the lock
	// make sure to refresh it regularly while it's running
	const refreshInterval = setInterval(async () => {
		await refreshLock();
	}, 1000 * 10);

	// iterate over all migrations
	for (const migration of migrations) {
		// check if the migration has already been applied
		const existingMigrationResult = migrationResults.find(
			(m) => m._id.toString() === migration._id.toString()
		);

		// check if the migration has already been applied
		if (existingMigrationResult) {
			console.log(`[MIGRATIONS] "${migration.name}" already applied. Skipping...`);
		} else {
			// check the modifiers to see if some cases match
			if (
				(migration.runForHuggingChat === "only" && !isHuggingChat) ||
				(migration.runForHuggingChat === "never" && isHuggingChat)
			) {
				console.log(
					`[MIGRATIONS] "${migration.name}" should not be applied for this run. Skipping...`
				);
				continue;
			}

			// otherwise all is good and we cna run the migration
			console.log(`[MIGRATIONS] "${migration.name}" not applied yet. Applying...`);

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

			await collections.migrationResults.updateOne(
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

	console.log("[MIGRATIONS] All migrations applied. Releasing lock");

	clearInterval(refreshInterval);
	await releaseLock();
}

export async function refreshAssistantsCountHelper() {
	const hourExpired = new Date().getUTCHours() + 1;

	const migrationResult = await collections.migrationResults.findOne<MigrationResult<number>>({
		_id: assistantsCountMigration._id,
	});
	if (migrationResult?.data === hourExpired) {
		// another instance already run the migration, so we exit early
		return;
	}

	// connect to the database
	const connectedClient = await client.connect();
	const lockKey = "assistants-count";

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
		{ _id: assistantsCountMigration._id },
		{
			$set: {
				name: assistantsCountMigration.name,
				status: "ongoing",
			},
		},
		{ upsert: true }
	);

	const session = connectedClient.startSession();
	let result = false;

	try {
		await session.withTransaction(async () => {
			result = await assistantsCountMigration.up(connectedClient);
		});
	} catch (e) {
		console.log(`"${assistantsCountMigration.name}" failed!`);
		console.error(e);
	} finally {
		await session.endSession();
	}

	await collections.migrationResults.updateOne(
		{ _id: assistantsCountMigration._id },
		{
			$set: {
				name: assistantsCountMigration.name,
				status: result ? "success" : "failure",
				data: hourExpired,
			},
		},
		{ upsert: true }
	);

	clearInterval(refreshInterval);
	await releaseLock(lockKey);
}

export function refreshAssistantsCount() {
	const ONE_HOUR_MS = 3_600_000;
	setInterval(refreshAssistantsCountHelper, ONE_HOUR_MS);
}
