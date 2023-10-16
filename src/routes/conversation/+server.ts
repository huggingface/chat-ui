import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import { models, validateModel } from "$lib/server/models";

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.text();

	let title = "";
	let messages: Message[] = [];

	const values = z
		.object({
			fromShare: z.string().optional(),
			model: validateModel(models),
			preprompt: z.string().optional(),
		})
		.parse(JSON.parse(body));

	let preprompt = values.preprompt;

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
		preprompt = conversation.preprompt;
	}

	const model = models.find((m) => m.name === values.model);

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: title || "New Chat",
		messages,
		model: values.model,
		preprompt: preprompt === model?.preprompt ? undefined : preprompt,
		createdAt: new Date(),
		updatedAt: new Date(),
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
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
	throw redirect(302, `${base}/`);
};
