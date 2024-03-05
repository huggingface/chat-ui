import { collections } from "$lib/server/database";

export async function acquireLock(key = "migrations") {
	try {
		const insert = await collections.semaphores.insertOne({
			key,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		return !!insert.acknowledged; // true if the document was inserted
	} catch (e) {
		// unique index violation, so there must already be a lock
		return false;
	}
}

export async function releaseLock(key = "migrations") {
	await collections.semaphores.deleteOne({
		key,
	});
}

export async function isDBLocked(key = "migrations"): Promise<boolean> {
	const res = await collections.semaphores.countDocuments({
		key,
	});
	return res > 0;
}

export async function refreshLock(key = "migrations") {
	await collections.semaphores.updateOne(
		{
			key,
		},
		{
			$set: {
				updatedAt: new Date(),
			},
		}
	);
}
