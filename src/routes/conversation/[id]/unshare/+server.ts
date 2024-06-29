import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import type { SharedConversation } from "$lib/types/SharedConversation";
import { getShareUrl } from "$lib/utils/getShareUrl";
import { hashConv } from "$lib/utils/hashConv";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { nanoid } from "nanoid";

export async function POST({ params, url, locals }) {
	// TODO: seems like this should be a PUT rather than a POST since it's an update
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	// Update the conversation to set shared to false
	await collections.conversations.updateOne(
		{ _id: new ObjectId(params.id), ...authCondition(locals) },
		{ $set: { shared: false } }
	);


	const hash = await hashConv(conversation);

	const existingShare = await collections.sharedConversations.findOne({ hash });

	if (existingShare) {
		// Delete it from the sharedConversations table in the database based on hash
		await collections.sharedConversations.deleteOne({ hash });
	}


	return new Response(
		JSON.stringify({
			message: "Conversation successfully unshared",
			shared: false
		}),
		{ 
			status: 200,
			headers: { "Content-Type": "application/json" }
		}
	);
}
