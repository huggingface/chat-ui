import { collections } from "$lib/server/database";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";
import { authCondition } from "$lib/server/auth";

export const load = async ({ params, locals }) => {
	// todo: add validation on params.id
	const conversation = await collections.conversations.findOne({
		_id: new ObjectId(params.id),
	});

	// if (!conversation) {
	// 	const conversationExists =
	// 		(await collections.conversations.countDocuments({
	// 			_id: new ObjectId(params.id),
	// 		})) !== 0;

	// 	if (conversationExists) {
	// 		throw error(
	// 			403,
	// 			"You don't have access to this conversation. If someone gave you this link, ask them to use the 'share' feature instead."
	// 		);
	// 	}

	// 	throw error(404, "Conversation not found.");
	// }

	try {

	return {
		messages: conversation.messages,
		title: conversation.title,
		model: conversation.model,
	};
}
catch (pblm) {
	throw error(404, "Hello " + pblm.message);
}
};
