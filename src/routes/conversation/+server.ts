import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import { defaultModel, models } from "$lib/server/models";
import { validateModel } from "$lib/utils/models";

export const POST: RequestHandler = async (input) => {
	const body = await input.request.text();

	let title = "";
	let messages: Message[] = [];

	const values = z
		.object({
			fromShare: z.string().optional(),
			model: validateModel(models).default(defaultModel.name),
		})
		.parse(JSON.parse(body));

	if (values.fromShare) {
		const conversation = await collections.sharedConversations.findOne({
			_id: values.fromShare,
		});

		if (!conversation) {
			throw error(404, "Conversation not found");
		}

		title = conversation.title;
		messages = conversation.messages;
		values.model = conversation.model;
	}

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title:
			title ||
			"Untitled " +
				((await collections.conversations.countDocuments({ sessionId: input.locals.sessionId })) +
					1),
		messages,
		model: values.model,
		createdAt: new Date(),
		updatedAt: new Date(),
		sessionId: input.locals.sessionId,
		...(values.fromShare ? { meta: { fromShareId: values.fromShare } } : {}),
	});

	return new Response(
		JSON.stringify({
			conversationId: res.insertedId.toString(),
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};

export const GET: RequestHandler = async () => {
	throw redirect(302, base || "/");
};
