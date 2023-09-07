import type { PageServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import type { WebSearchMessageResult } from "$lib/types/WebSearch";

export const load: PageServerLoad = async ({ params }) => {
	const conversation = await collections.sharedConversations.findOne({
		_id: params.id,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const webSearchesId = conversation.messages
		.filter((message) => message.webSearchId)
		.map((message) => new ObjectId(message.webSearchId));

	const results = await collections.webSearches.find({ _id: { $in: webSearchesId } }).toArray();

	const searches = Object.fromEntries(
		results.map((x) => [
			x._id.toString(),
			[...x.messages, { type: "result", id: x._id.toString() } satisfies WebSearchMessageResult],
		])
	);

	return {
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
		searches,
	};
};
