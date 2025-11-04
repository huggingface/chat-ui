import { collections } from "$lib/server/database";
import { MetricsServer } from "$lib/server/metrics";
import { error, redirect } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import type { PageServerLoad } from "./$types";
import { authCondition } from "$lib/server/auth";

async function createConversationFromShare(
	fromShareId: string,
	locals: App.Locals,
	userAgent?: string
) {
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

export const load: PageServerLoad = async ({ url, params, locals, request }) => {
	const leafId = url.searchParams.get("leafId");

	if ((locals.user || locals.sessionId) && params.id) {
		const conversationId = await createConversationFromShare(
			params.id,
			locals,
			request.headers.get("User-Agent") ?? undefined
		);
		return redirect(302, `../conversation/${conversationId}?leafId=${leafId}`);
	}

	return redirect(302, `../conversation/${params.id}?leafId=${leafId}`);
};
