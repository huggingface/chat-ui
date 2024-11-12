import type { Migration } from ".";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { logger } from "$lib/server/logger";

export async function deleteConversations(
	collections: typeof import("$lib/server/database").collections
) {
	let deleteCount = 0;
	const { conversations, sessions } = collections;

	// First delete conversations with no messages that are older than 1 hour
	const emptyResult = await conversations.deleteMany({
		$nor: [{ "messages.from": "user" }, { "messages.from": "assistant" }],
		createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) },
	});

	deleteCount += emptyResult.deletedCount;

	// Then delete orphaned conversations (no userId but has sessionId that doesn't exist)
	const orphanedResult = await conversations.deleteMany({
		userId: { $exists: false },
		$or: [
			{ sessionId: { $exists: false } },
			{ sessionId: { $nin: (await sessions.distinct("_id")).map((id) => id.toString()) } },
		],
	});

	deleteCount += orphanedResult.deletedCount;

	logger.info(`[MIGRATIONS] Deleted ${deleteCount} conversations`);
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
