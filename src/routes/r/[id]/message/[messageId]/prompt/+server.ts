import { buildPrompt } from "$lib/buildPrompt";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import { error } from "@sveltejs/kit";

export async function GET({ params }) {
	const conv = await collections.sharedConversations.findOne({
		_id: params.id,
	});

	if (!conv) {
		throw error(404, "Conversation not found");
	}

	const messageId = params.messageId;

	const messageIndex = conv.messages.findIndex((msg) => msg.id === messageId);

	if (messageIndex === -1) {
		throw error(404, "Message not found");
	}

	const model = models.find((m) => m.id === conv.model);

	if (!model) {
		throw error(404, "Conversation model not found");
	}

	const prompt = await buildPrompt({ messages: conv.messages.slice(0, messageIndex + 1), model });

	return new Response(
		JSON.stringify(
			{
				note: "This is a preview of the prompt that will be sent to the model when retrying the message. It may differ from what was sent in the past if the parameters have been updated since",
				prompt,
				model: model.name,
				parameters: {
					...model.parameters,
					return_full_text: false,
				},
			},
			null,
			2
		),
		{ headers: { "Content-Type": "application/json" } }
	);
}
