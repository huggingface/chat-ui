import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import { models, validateModel } from "$lib/server/models";
import { defaultEmbeddingModel } from "$lib/server/embeddingModels";

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
	let embeddingModel: string;

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
		embeddingModel = conversation.embeddingModel;
		preprompt = conversation.preprompt;
	}

	const model = models.find((m) => m.name === values.model);

	if (!model) {
		throw error(400, "Invalid model");
	}

	embeddingModel ??= model.embeddingModel ?? defaultEmbeddingModel.name;

	if (model.unlisted) {
		throw error(400, "Can't start a conversation with an unlisted model");
	}

	// Use the model preprompt if there is no conversation/preprompt in the request body
	preprompt = preprompt === undefined ? model?.preprompt : preprompt;

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: title || "New Chat",
		messages,
		model: values.model,
		preprompt: preprompt === model?.preprompt ? model?.preprompt : preprompt,
		createdAt: new Date(),
		updatedAt: new Date(),
		embeddingModel: embeddingModel,
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
