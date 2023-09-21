import type { PageServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ params }) => {
	const conversation = await collections.sharedConversations.findOne({
		_id: params.id,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	return {
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
	};
};
