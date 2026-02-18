import { buildPrompt } from "$lib/buildPrompt";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";
import { sanitizeParamId } from "$lib/server/mongoSanitize";

export async function GET({ params, locals }) {
	// Sanitize params.id to prevent NoSQL injection
	const sanitizedId = sanitizeParamId(params.id);

	const conv =
		sanitizedId.length === 7
			? await collections.sharedConversations.findOne({
					_id: sanitizedId,
				})
			: await collections.conversations.findOne({
					_id: new ObjectId(sanitizedId),
					...authCondition(locals),
				});

	if (conv === null) {
		error(404, "Conversation not found");
	}

	const messageId = params.messageId;

	const messageIndex = conv.messages.findIndex((msg) => msg.id === messageId);

	if (!isMessageId(messageId) || messageIndex === -1) {
		error(404, "Message not found");
	}

	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		error(404, "Conversation model not found");
	}

	const messagesUpTo = buildSubtree(conv, messageId);

	const prompt = await buildPrompt({
		preprompt: conv.preprompt,
		messages: messagesUpTo,
		model,
	}).catch((err) => {
		console.error(err);
		return "Prompt generation failed";
	});

	return Response.json({
		prompt,
		model: model.name,
		parameters: {
			...model.parameters,
			return_full_text: false,
		},
		messages: messagesUpTo.map((msg) => ({
			role: msg.from,
			content: msg.content,
			createdAt: msg.createdAt,
			updatedAt: msg.updatedAt,
			updates: msg.updates?.filter((u) => u.type === "title"),
			files: msg.files,
		})),
	});
}
