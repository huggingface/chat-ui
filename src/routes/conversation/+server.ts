import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error, redirect } from "@sveltejs/kit";
import { base } from "$app/paths";
import { z } from "zod";
import type { Message } from "$lib/types/Message";
import { models, validateModel } from "$lib/server/models";
import { defaultEmbeddingModel } from "$lib/server/embeddingModels";
import { v4 } from "uuid";
import { authCondition } from "$lib/server/auth";
import { usageLimits } from "$lib/server/usageLimits";
import { MetricsServer } from "$lib/server/metrics";

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.text();

	let title = "";

	const parsedBody = z
		.object({
			fromShare: z.string().optional(),
			model: validateModel(models),
			assistantId: z.string().optional(),
			preprompt: z.string().optional(),
		})
		.safeParse(JSON.parse(body));

	if (!parsedBody.success) {
		throw error(400, "Invalid request");
	}
	const values = parsedBody.data;

	const convCount = await collections.conversations.countDocuments(authCondition(locals));

	if (usageLimits?.conversations && convCount > usageLimits?.conversations) {
		throw error(
			429,
			"You have reached the maximum number of conversations. Delete some to continue."
		);
	}

	const model = models.find((m) => (m.id || m.name) === values.model);

	if (!model) {
		throw error(400, "Invalid model");
	}

	let messages: Message[] = [
		{
			id: v4(),
			from: "system",
			content: values.preprompt ?? "",
			createdAt: new Date(),
			updatedAt: new Date(),
			children: [],
			ancestors: [],
		},
	];

	let rootMessageId: Message["id"] = messages[0].id;
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
		rootMessageId = conversation.rootMessageId ?? rootMessageId;
		values.model = conversation.model;
		values.preprompt = conversation.preprompt;
		values.assistantId = conversation.assistantId?.toString();
		embeddingModel = conversation.embeddingModel;
	}

	embeddingModel ??= model.embeddingModel ?? defaultEmbeddingModel.name;

	if (model.unlisted) {
		throw error(400, "Can't start a conversation with an unlisted model");
	}

	// get preprompt from assistant if it exists
	const assistant = await collections.assistants.findOne({
		_id: new ObjectId(values.assistantId),
	});

	if (assistant) {
		values.preprompt = assistant.preprompt;
	} else {
		values.preprompt ??= model?.preprompt ?? "";
	}

	if (messages && messages.length > 0 && messages[0].from === "system") {
		messages[0].content = values.preprompt;
	}

	const res = await collections.conversations.insertOne({
		_id: new ObjectId(),
		title: title || "New Chat",
		rootMessageId,
		messages,
		model: values.model,
		preprompt: values.preprompt,
		assistantId: values.assistantId ? new ObjectId(values.assistantId) : undefined,
		createdAt: new Date(),
		updatedAt: new Date(),
		userAgent: request.headers.get("User-Agent") ?? undefined,
		embeddingModel,
		...(locals.user ? { userId: locals.user._id } : { sessionId: locals.sessionId }),
		...(values.fromShare ? { meta: { fromShareId: values.fromShare } } : {}),
	});

	MetricsServer.getMetrics().model.conversationsTotal.inc({ model: values.model });

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
