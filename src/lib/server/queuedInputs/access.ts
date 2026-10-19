import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { isMlAssistantConversation } from "$lib/server/mlAssistant";
import { error } from "@sveltejs/kit";
import { ObjectId } from "mongodb";

export async function ownedMlConversation(
	params: { id: string },
	locals: App.Locals
): Promise<ObjectId> {
	if (!locals.user && !locals.sessionId) error(401, "Unauthorized");
	if (!ObjectId.isValid(params.id)) error(404, "Conversation not found");
	const conversation = await collections.conversations.findOne(
		{ _id: new ObjectId(params.id), ...authCondition(locals) },
		{ projection: { _id: 1, mlAssistant: 1 } }
	);
	if (!conversation) error(404, "Conversation not found");
	if (!isMlAssistantConversation(conversation)) error(400, "Only ML Intern conversations queue");
	return conversation._id;
}
