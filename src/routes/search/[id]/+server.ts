import { collections } from "$lib/server/database";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function GET({ params, locals }) {
	const searchId = new ObjectId(params.id);

	const search = await collections.webSearches.findOne({
		_id: searchId,
	});

	if (!search) {
		throw error(404, "Search query not found");
	}

	const conv = await collections.conversations.findOne({
		_id: search.convId,
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	if (!conv.userId || locals.user?._id.toString() !== conv.userId.toString()) {
		throw error(403, "You don't have access to the conversation here.");
	}

	return new Response(JSON.stringify(search), { headers: { "Content-Type": "application/json" } });
}
