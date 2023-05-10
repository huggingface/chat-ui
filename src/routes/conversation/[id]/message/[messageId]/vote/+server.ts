import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { z } from "zod";

export async function POST({ params, request, locals }) {
	const { score } = z
		.object({
			score: z.number().int().min(-1).max(1),
		})
		.parse(await request.json());
	const conversationId = new ObjectId(params.id);
	const messageId = params.messageId;

	const conversation = await collections.conversations.findOne({
		_id: conversationId,
		sessionId: locals.sessionId,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	if (!conversation.messages.find((message) => message.id === messageId)) {
		throw error(404, "Message not found");
	}

	if (score !== 0) {
		await collections.conversations.updateOne(
			{
				_id: conversationId,
				"messages.id": messageId,
			},
			{
				$set: {
					"messages.$.score": score,
				},
			}
		),
			{ upsert: true };
	} else {
		await collections.conversations.updateOne(
			{
				_id: conversationId,
				"messages.id": messageId,
			},
			{ $unset: { "messages.$.score": "" } }
		);
	}

	return new Response();
}
