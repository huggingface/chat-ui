import { collections } from "$lib/server/database";
import { MetricsServer } from "$lib/server/metrics";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { authCondition } from "$lib/server/auth";

/**
 * Create a new conversation from a shared conversation ID.
 * If the conversation already exists for the user/session, return the existing conversation ID.
 * returns the conversation ID.
 */
export async function createConversationFromShare(
	fromShareId: string,
	locals: App.Locals,
	userAgent?: string
): Promise<string> {
	const conversation = await collections.sharedConversations.findOne({
		_id: fromShareId,
	});

	if (!conversation) {
		error(404, "Conversation not found");
	}

	// Check if shared conversation exists already for this user/session
	const existingConversation = await collections.conversations.findOne({
		"meta.fromShareId": fromShareId,
		...authCondition(locals),
	});

	if (existingConversation) {
		return existingConversation._id.toString();
	}

	// Create new conversation from shared conversation
	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: conversation.title.replace(/<\/?think>/gi, "").trim(),
		rootMessageId: conversation.rootMessageId,
		messages: conversation.messages,
		model: conversation.model,
		preprompt: conversation.preprompt,
		createdAt: new Date(),
		updatedAt: new Date(),
		userAgent,
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
		meta: { fromShareId },
	});

	if (MetricsServer.isEnabled()) {
		MetricsServer.getMetrics().model.conversationsTotal.inc({ model: conversation.model });
	}
	return res.insertedId.toString();
}
