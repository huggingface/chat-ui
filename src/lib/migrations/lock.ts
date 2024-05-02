import { Database } from "$lib/server/database";
import { ObjectId } from "mongodb";

/**
 * Returns the lock id if the lock was acquired, false otherwise
 */
export async function acquireLock(key: string): Promise<ObjectId | false> {
	try {
		const id = new ObjectId();

		const insert = await Database.getInstance().getCollections().semaphores.insertOne({
			_id: id,
			key,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		return insert.acknowledged ? id : false; // true if the document was inserted
	} catch (e) {
		// unique index violation, so there must already be a lock
		return false;
	}
}

export async function releaseLock(key: string, lockId: ObjectId) {
	await Database.getInstance().getCollections().semaphores.deleteOne({
		_id: lockId,
		key,
	});
}

export async function isDBLocked(key: string): Promise<boolean> {
	const res = await Database.getInstance().getCollections().semaphores.countDocuments({
		key,
	});
	return res > 0;
}

export async function refreshLock(key: string, lockId: ObjectId): Promise<boolean> {
	const result = await Database.getInstance().getCollections().semaphores.updateOne(
		{
			_id: lockId,
			key,
		},
		{
			$set: {
				updatedAt: new Date(),
			},
		}
	);

	return result.matchedCount > 0;
}
