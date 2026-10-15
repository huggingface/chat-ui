import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";

/** All HTTP mutation routes for conversations, including legacy endpoints. */
export async function isSlackConversationMutation(
	method: string,
	routeId: string | null,
	id?: string
) {
	if (["GET", "HEAD", "OPTIONS"].includes(method) || !id || !ObjectId.isValid(id)) return false;
	if (!routeId || !/^\/(?:api\/(?:v2\/)?)?conversations?\/\[id\](?:\/|$)/.test(routeId))
		return false;
	return !!(await collections.slackThreads.findOne(
		{ conversationId: new ObjectId(id) },
		{ projection: { _id: 1 } }
	));
}

/** Bulk deletion follows the same read-only policy as single-session deletion. */
export async function nonSlackConversationIds(ids: ObjectId[]): Promise<ObjectId[]> {
	const linked = await collections.slackThreads
		.find({ conversationId: { $in: ids } })
		.project<{ conversationId: ObjectId }>({ conversationId: 1 })
		.toArray();
	const protectedIds = new Set(linked.map((t) => t.conversationId.toString()));
	return ids.filter((id) => !protectedIds.has(id.toString()));
}
