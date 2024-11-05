import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

/**
 * Ideally, we'd be able to detect the client-side abort, see https://github.com/huggingface/chat-ui/pull/88#issuecomment-1523173850
 */
export async function POST({ params, locals }) {
	const conversationId = new ObjectId(params.id);

	const conversation = await collections.conversations.findOne({
		_id: conversationId,
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	await collections.abortedGenerations.updateOne(
		{ conversationId },
		{ $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
		{ upsert: true }
	);

	return new Response();
}
