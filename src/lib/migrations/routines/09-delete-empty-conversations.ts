import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";

const BATCH_SIZE = 1000;
const DELETE_THRESHOLD_MS = 60 * 60 * 1000;

export async function deleteConversations(
	collections: typeof import("$lib/server/database").collections
) {
	let deleteCount = 0;
	const { conversations, sessions } = collections;

	const validSessionIdsArray = await sessions.distinct("sessionId");

	// Define the two deletion criteria
	// if the conversation has no user or assistant messages and is older than 1 hour
	// or if the conversation has no user ID and no session ID that exists in the sessions collection
	const deletionCriteria = [
		{
			filter: {
				"messages.from": { $not: { $in: ["user", "assistant"] } },
				createdAt: { $lt: new Date(Date.now() - DELETE_THRESHOLD_MS) },
			},
		},
		{
			filter: {
				userId: { $exists: false },
				sessionId: { $nin: validSessionIdsArray },
			},
		},
	];

	for (const { filter } of deletionCriteria) {
		const cursor = conversations.find(filter).batchSize(BATCH_SIZE);

		while (await cursor.hasNext()) {
			const batch = [];
			for (let i = 0; i < BATCH_SIZE; i++) {
				if (await cursor.hasNext()) {
					const doc = await cursor.next();
					if (doc) {
						batch.push(doc._id);
					}
				} else {
					break;
				}
			}

			if (batch.length > 0) {
				const deleteResult = await conversations.deleteMany({
					_id: { $in: batch },
				});
				deleteCount += deleteResult.deletedCount;
			}
		}
	}

	logger.info(`[MIGRATIONS] Deleted ${deleteCount} conversations in total.`);
	return deleteCount;
}

const deleteEmptyConversations: Migration = {
	_id: new ObjectId("000000000000000000000009"),
	name: "Delete conversations with no user or assistant messages or valid sessions",
	up: async () => {
		await deleteConversations(collections);
		return true;
	},
	runEveryTime: true,
	runForHuggingChat: "only",
};

export default deleteEmptyConversations;
