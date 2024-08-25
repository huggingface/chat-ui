import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";
import { authCondition } from "$lib/server/auth";
import { UrlDependency } from "$lib/types/UrlDependency";
import { convertLegacyConversation } from "$lib/utils/tree/convertLegacyConversation.js";

export const load = async ({ params, depends, locals }) => {
	let conversation;
	let shared = false;

	// if the conver
	if (params.id.length === 7) {
		// shared link of length 7
		conversation = await collections.sharedConversations.findOne({
			_id: params.id,
		});
		shared = true;

		if (!conversation) {
			error(404, "Conversation not found");
		}
	} else {
		// todo: add validation on params.id
		conversation = await collections.conversations.findOne({
			_id: new ObjectId(params.id),
			...authCondition(locals),
		});

		depends(UrlDependency.Conversation);

		if (!conversation) {
			const conversationExists =
				(await collections.conversations.countDocuments({
					_id: new ObjectId(params.id),
				})) !== 0;

			if (conversationExists) {
				error(
					403,
					"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
				);
			}

			error(404, "Conversation not found.");
		}
	}

	const convertedConv = { ...conversation, ...convertLegacyConversation(conversation) };

	return {
		messages: convertedConv.messages,
		title: convertedConv.title,
		model: convertedConv.model,
		preprompt: convertedConv.preprompt,
		rootMessageId: convertedConv.rootMessageId,
		assistant: convertedConv.assistantId
			? JSON.parse(
					JSON.stringify(
						await collections.assistants.findOne({
							_id: new ObjectId(convertedConv.assistantId),
						})
					)
			  )
			: null,
		shared,
	};
};

export const actions = {
	deleteBranch: async ({ request, locals, params }) => {
		const data = await request.formData();
		const messageId = data.get("messageId");

		if (!messageId || typeof messageId !== "string") {
			error(400, "Invalid message id");
		}

		const conversation = await collections.conversations.findOne({
			...authCondition(locals),
			_id: new ObjectId(params.id),
		});

		if (!conversation) {
			error(404, "Conversation not found");
		}

		const filteredMessages = conversation.messages
			.filter(
				(message) =>
					// not the message AND the message is not in ancestors
					!(message.id === messageId) && message.ancestors && !message.ancestors.includes(messageId)
			)
			.map((message) => {
				// remove the message from children if it's there
				if (message.children && message.children.includes(messageId)) {
					message.children = message.children.filter((child) => child !== messageId);
				}
				return message;
			});

		await collections.conversations.updateOne(
			{ _id: conversation._id, ...authCondition(locals) },
			{ $set: { messages: filteredMessages } }
		);

		return { from: "deleteBranch", ok: true };
	},
};
