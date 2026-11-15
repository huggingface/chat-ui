import { deleteStoredFilesOf } from "$lib/server/files/toolImages";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { deleteMlFilesOf } from "$lib/server/mlFiles/store";
import { deleteMlRegistry } from "$lib/server/mlRegistry/store";
import { deleteMlReviewsOf } from "$lib/server/mlReviews/store";
import { validModelIdSchema } from "$lib/server/models";
import { applyConversationSettings } from "$lib/server/conversationSettings";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";
import { z } from "zod";
export { generateConversationResponse as POST } from "$lib/server/generation/conversationRequest";

export async function DELETE({ locals, params }) {
	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	await collections.conversations.deleteOne({ _id: conv._id });
	await deleteMlFilesOf([conv._id]);
	await deleteStoredFilesOf([conv._id]);
	await deleteMlRegistry([conv._id]);
	await deleteMlReviewsOf([conv._id]);

	return new Response();
}

export async function PATCH({ request, locals, params }) {
	const values = z
		.object({
			title: z.string().trim().min(1).max(100).optional(),
			model: validModelIdSchema.optional(),
		})
		.parse(await request.json());

	const convId = new ObjectId(params.id);

	const conv = await collections.conversations.findOne({
		_id: convId,
		...authCondition(locals),
	});

	if (!conv) {
		error(404, "Conversation not found");
	}

	await applyConversationSettings({ _id: convId }, values);

	return new Response();
}
