import { collections } from "$lib/server/database";

// 5min time out on lock
const LOCK_TIMEOUT = 5 * 60 * 1000;

export async function createAndAcquireLock(): Promise<boolean> {
	try {
		const upsert = await collections.semaphores.updateOne(
			{},
			{
				$setOnInsert: {
					isDBLocked: true,
					key: "semaphore",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			},
			{
				upsert: true,
			}
		);
		return !!upsert.upsertedCount; // true if the document was inserted
	} catch (e) {
		// unique index violation, so there must already be a lock
		return false;
	}
}
export async function acquireLock() {
	const res = await collections.semaphores.findOneAndUpdate(
		{
			isDBLocked: false,
		},
		{
			$set: {
				isDBLocked: true,
				updatedAt: new Date(),
			},
		}
	);

	return !!res.ok && res.value !== null;
}

export async function releaseLock() {
	await collections.semaphores.updateOne(
		{
			isDBLocked: true,
		},
		{
			$set: {
				isDBLocked: false,
				updatedAt: new Date(),
			},
		}
	);
}

export async function isDBLocked(): Promise<boolean> {
	const res = await collections.semaphores.findOne({});
	if (!res) {
		throw new Error("No lock found");
	}
	return res.isDBLocked;
}

export async function refreshLock() {
	await collections.semaphores.updateOne(
		{
			isDBLocked: true,
		},
		{
			$set: {
				updatedAt: new Date(),
			},
		}
	);
}

export async function discardExpiredLock() {
	const res = await collections.semaphores.updateOne(
		{
			isDBLocked: true,
			updatedAt: { $lt: new Date(Date.now() - LOCK_TIMEOUT) },
		},
		{
			$set: {
				isDBLocked: false,
				updatedAt: new Date(),
			},
		}
	);

	return res.modifiedCount > 0;
}
