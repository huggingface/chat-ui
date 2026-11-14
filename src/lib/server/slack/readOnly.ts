import { ObjectId } from "mongodb";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { AbortRegistry } from "$lib/server/abortRegistry";
import { isManagedConversation } from "$lib/server/mlRun/managed";
import type { Conversation } from "$lib/types/Conversation";
import type { MlReview } from "$lib/types/MlReview";

// Slack links reviews to the web, and submitting one resumes the run server-side; checking
// a wait early only moves the parked turn's timer, so the sweep resumes it like any other
const SERVER_RESUMED_ROUTES = new Set([
	"/api/v2/conversations/[id]/reviews/[reviewId]",
	"/api/v2/conversations/[id]/reviews/[reviewId]/submit",
	"/conversation/[id]/wake",
]);

const isSlackManaged = (conv: Pick<Conversation, "managedBy" | "sessionId">) =>
	isManagedConversation(conv) || !!conv.sessionId?.startsWith("slack-user:");

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
	if (route === "/conversation/[id]/share") return false;
	if (SERVER_RESUMED_ROUTES.has(route)) return false;
	const conv = await collections.conversations.findOne(
		{ _id: new ObjectId(id), ...authCondition(locals) },
		{ projection: { managedBy: 1, sessionId: 1 } }
	);
	if (!conv || !isSlackManaged(conv)) return false;
	if (method === "DELETE" && /\/\[id\]$/.test(route)) {
		await retireSlackConversations([conv._id]);
		return false;
	}
	return true;
}

/** Once Slack moves past a review, submitting it would post a new turn the thread never shows. */
export async function isDetachedSlackReview(
	review: Pick<MlReview, "conversationId" | "elicitationId">
): Promise<boolean> {
	const conv = await collections.conversations.findOne(
		{ _id: review.conversationId },
		{ projection: { managedBy: 1, sessionId: 1 } }
	);
	if (!conv || !isSlackManaged(conv)) return false;
	const waiting = await collections.mcpElicitations.findOne(
		{
			conversationId: review.conversationId,
			elicitationId: review.elicitationId,
			status: "pending",
			"pending.kind": "review",
		},
		{ projection: { _id: 1 } }
	);
	return !waiting;
}
