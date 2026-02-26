import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { error } from "@sveltejs/kit";
import { generateGroupName } from "$lib/server/textGeneration/groupName";
import type { Conversation } from "$lib/types/Conversation";

export const POST: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const groupId = new ObjectId(params.id);

	const group = await collections.conversationGroups.findOne({
		_id: groupId,
		...authCondition(locals),
	});

	if (!group) {
		error(404, "Group not found");
	}

	const convs = await collections.conversations
		.find({ groupId, ...authCondition(locals) })
		.project<Pick<Conversation, "title">>({ title: 1 })
		.toArray();

	const titles = convs.map((c) => c.title);
	const name = (await generateGroupName(titles, locals)) ?? "New Group";

	await collections.conversationGroups.updateOne(
		{ _id: groupId },
		{ $set: { name, updatedAt: new Date() } }
	);

	return superjsonResponse({ name });
};
