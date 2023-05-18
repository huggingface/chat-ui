import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";
import { authCondition } from "$lib/server/auth";
import { z } from "zod";
import { generateMessage } from "$lib/server/message";
import type { Message } from "$lib/types/Message";

export const load = async ({ params, locals }) => {
	// todo: add validation on params.id
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
		...authCondition(locals),
	});

	if (!conversation) {
		const conversationExists =
			(await collections.conversations.countDocuments({
				_id: new ObjectId(params.id),
			})) !== 0;

		if (conversationExists) {
			throw error(
				403,
				"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
			);
		}

		throw error(404, "Conversation not found.");
	}

	return {
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
	};
};

export const actions = {
	post: async function (actionParams) {
		const { request } = actionParams;

		const formData = await request.formData();

		const { messages } = await generateMessage(
			Object.fromEntries(formData.entries()),
			actionParams
		);

		return {
			messages: await messages,
		};
	},
};
