import { base } from "$app/paths";
import { PUBLIC_ORIGIN } from "$env/static/public";
import { collections } from "$lib/server/database.js";
import type { SharedConversation } from "$lib/types/SharedConversation.js";
import { sha256 } from "$lib/utils/sha256.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { nanoid } from "nanoid";

export async function POST({ params, url, locals }) {
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		sessionId: locals.sessionId,
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const hash = await sha256(JSON.stringify(conversation.messages));

	const existingShare = await collections.sharedConversations.findOne({ hash });

	if (existingShare) {
		return new Response(
			JSON.stringify({
				url: (PUBLIC_ORIGIN || `${url.origin}${base}`) + `/r/${existingShare._id}`,
			}),
			{ headers: { "Content-Type": "application/json" } }
		);
	}

	const shared: SharedConversation = {
		_id: nanoid(7),
		createdAt: new Date(),
		messages: conversation.messages,
		hash,
		updatedAt: new Date(),
		title: conversation.title,
	};

	await collections.sharedConversations.insertOne(shared);

	return new Response(
		JSON.stringify({
			url: `${PUBLIC_ORIGIN || url.origin}${base}/r/${shared._id}`,
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
}
