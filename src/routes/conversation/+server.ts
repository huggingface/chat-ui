import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";

export const POST: RequestHandler = async (input) => {
	const body = await input.request.text();

	let title = "";
	let messages: Message[] = [];
	let fromShareId: string | undefined;

	if (body) {
		fromShareId = z.object({ fromShare: z.string().optional() }).parse(JSON.parse(body)).fromShare;

		if (fromShareId) {
			const conversation = await collections.sharedConversations.findOne({
				_id: fromShareId,
			});

			if (!conversation) {
				throw error(404, "Conversation not found");
			}

			title = conversation.title;
			messages = conversation.messages;
		}
	}

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title:
			title ||
			"Untitled " +
				((await collections.conversations.countDocuments({ sessionId: input.locals.sessionId })) +
					1),
		messages,
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: input.locals.sessionId,
		...(fromShareId ? { meta: { fromShareId } } : {}),
	});

	return new Response(
		JSON.stringify({
			conversationId: res.insertedId.toString(),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};

export const GET: RequestHandler = async () => {
	throw redirect(301, base || "/");
};
