import type { PageServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (event) => {
	// todo: add validation on params.id
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(event.params.id),
		sessionId: event.locals.sessionId,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	return {
		messages: conversation.messages,
	};
};
