import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { AbortRegistry } from "$lib/server/abortRegistry";

export async function retireSlackConversations(ids: ObjectId[]): Promise<ObjectId[]> {
	await collections.slackThreads.updateMany(
		{ conversationId: { $in: ids } },
		{ $set: { deletedAt: new Date(), watching: false } }
	);
	for (const id of ids) AbortRegistry.getInstance().abort(id.toHexString());
	return ids;
}

/** Enforce after ownership filtering, including route groups and legacy endpoints. */
export async function isSlackConversationMutation(
	method: string,
	routeId: string | null,
	id: string | undefined,
	locals?: App.Locals
) {
	if (["GET", "HEAD", "OPTIONS"].includes(method) || !id || !ObjectId.isValid(id) || !locals)
		return false;
	const route = routeId?.replace(/\/\([^/]+\)/g, "");
	if (!route || !/^\/(?:api\/(?:v2\/)?)?conversations?\/\[id\](?:\/|$)/.test(route)) return false;
	const conv = await collections.conversations.findOne(
		{ _id: new ObjectId(id), ...authCondition(locals) },
		{ projection: { managedBy: 1, sessionId: 1 } }
	);
	if (!conv || !(conv.managedBy?.kind === "slack" || conv.sessionId?.startsWith("slack-user:")))
		return false;
	if (method === "DELETE" && /\/\[id\]$/.test(route)) {
		await retireSlackConversations([conv._id]);
		return false;
	}
	return true;
}
