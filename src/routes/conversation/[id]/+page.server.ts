import type { PageServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (event) => {
	// todo: add validation on params.id
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(event.params.id),
		sessionId: event.locals.sessionId,
	});

	if (!conversation) {
		const conversationExists =
			(await collections.conversations.countDocuments({
				_id: new ObjectId(event.params.id),
			})) !== 0;

		if (conversationExists) {
			throw error(
				403,
				"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
			);
		}

		throw error(404, "Conversation not found.");
	}

	return {
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
	};
};
