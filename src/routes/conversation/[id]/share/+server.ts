import { base } from "$app/paths";
import { PUBLIC_ORIGIN, PUBLIC_SHARE_PREFIX } from "$env/static/public";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import type { SharedConversation } from "$lib/types/SharedConversation";
import { hashConv } from "$lib/utils/hashConv.js";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { nanoid } from "nanoid";

export async function POST({ params, url, locals }) {
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		...authCondition(locals),
	});

	if (!conversation) {
		throw error(404, "Conversation not found");
	}

	const hash = await hashConv(conversation);

	const existingShare = await collections.sharedConversations.findOne({ hash });

	if (existingShare) {
		return new Response(
			JSON.stringify({
				url: getShareUrl(url, existingShare._id),
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
		model: conversation.model,
	};

	await collections.sharedConversations.insertOne(shared);

	return new Response(
		JSON.stringify({
			url: getShareUrl(url, shared._id),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
}

function getShareUrl(url: URL, shareId: string): string {
	return `${PUBLIC_SHARE_PREFIX || `${PUBLIC_ORIGIN || url.origin}${base}`}/r/${shareId}`;
}
