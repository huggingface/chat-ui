import { buildPrompt } from "$lib/buildPrompt";
import { models } from "$lib/server/models";
import { buildSubtree } from "$lib/utils/tree/buildSubtree";
import { isMessageId } from "$lib/utils/tree/isMessageId";
import { error } from "@sveltejs/kit";
import type { Conversation } from "$lib/types/Conversation";
import { z } from "zod";

export async function GET({ params, request }) {
	// Get conversation data from query parameter (client-side storage)
	const conversationJson = new URL(request.url).searchParams.get("conversation");

	if (!conversationJson) {
		error(400, "Conversation data required");
	}

	let conv: Conversation;
	try {
		conv = z
			.object({
				id: z.string(),
				model: z.string(),
				messages: z.array(z.any()),
				preprompt: z.string().optional(),
			})
			.parse(JSON.parse(conversationJson)) as Conversation;

		if (conv.id !== params.id) {
			error(400, "Conversation ID mismatch");
		}
	} catch (err) {
		error(400, "Invalid conversation data");
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
