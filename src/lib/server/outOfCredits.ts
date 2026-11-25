import type { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { logger } from "$lib/server/logger";

/** lets a returning user see the notice before sending into another 402 */
export async function markOutOfCredits(userId: ObjectId): Promise<void> {
	await collections.users
		.updateOne({ _id: userId }, { $set: { outOfCreditsAt: new Date() } })
		.catch((err) => logger.error(err, "[credits] could not mark user out of credits"));
}

export async function clearOutOfCredits(userId: ObjectId): Promise<void> {
	await collections.users
		.updateOne(
			{ _id: userId, outOfCreditsAt: { $exists: true } },
			{ $unset: { outOfCreditsAt: "" } }
		)
		.catch((err) => logger.error(err, "[credits] could not clear out-of-credits flag"));
}
