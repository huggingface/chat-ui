import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";

export enum Semaphores {
	ASSISTANTS_COUNT = "assistants.count",
	CONVERSATION_STATS = "conversation.stats",
	CONFIG_UPDATE = "config.update",
	MIGRATION = "migration",
	TEST_MIGRATION = "test.migration",
}
/**
 * Returns the lock id if the lock was acquired, false otherwise
 */
export async function acquireLock(key: Semaphores): Promise<ObjectId | false> {
	try {
		const id = new ObjectId();

		const insert = await collections.semaphores.insertOne({
			_id: id,
			key,
			createdAt: new Date(),
			updatedAt: new Date(),
			deleteAt: new Date(Date.now() + 1000 * 60 * 3), // 3 minutes
		});

		return insert.acknowledged ? id : false; // true if the document was inserted
	} catch (e) {
		// unique index violation, so there must already be a lock
		return false;
	}
}

export async function releaseLock(key: Semaphores, lockId: ObjectId) {
	await collections.semaphores.deleteOne({
		_id: lockId,
		key,
	});
}

export async function isDBLocked(key: Semaphores): Promise<boolean> {
	const res = await collections.semaphores.countDocuments({
		key,
	});
	return res > 0;
}

export async function refreshLock(key: Semaphores, lockId: ObjectId): Promise<boolean> {
	const result = await collections.semaphores.updateOne(
		{
			_id: lockId,
			key,
		},
		{
			$set: {
				updatedAt: new Date(),
				deleteAt: new Date(Date.now() + 1000 * 60 * 3), // 3 minutes
			},
		}
	);

	return result.matchedCount > 0;
}
