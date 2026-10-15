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
