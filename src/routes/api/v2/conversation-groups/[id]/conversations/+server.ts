import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { error } from "@sveltejs/kit";
import type { Conversation } from "$lib/types/Conversation";

const membershipSchema = z.object({
	add: z.array(z.string()).optional(),
	remove: z.array(z.string()).optional(),
});

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const groupId = new ObjectId(params.id);
	const body = membershipSchema.parse(await request.json());

	// Verify group belongs to user
	const group = await collections.conversationGroups.findOne({
		_id: groupId,
		...authCondition(locals),
	});

	if (!group) {
		error(404, "Group not found");
	}

	const auth = authCondition(locals);

	if (body.add?.length) {
		const addIds = body.add.map((id) => new ObjectId(id));

		// Verify conversations belong to user
		const count = await collections.conversations.countDocuments({
			_id: { $in: addIds },
			...auth,
		});
		if (count !== addIds.length) {
			error(404, "One or more conversations not found");
		}

		await collections.conversations.updateMany(
			{ _id: { $in: addIds }, ...auth },
			{ $set: { groupId } }
		);
	}

	if (body.remove?.length) {
		const removeIds = body.remove.map((id) => new ObjectId(id));
		await collections.conversations.updateMany(
			{ _id: { $in: removeIds }, groupId, ...auth },
			{ $unset: { groupId: "" } }
		);
	}

	// Check if group is now empty
	const remaining = await collections.conversations.countDocuments({
		groupId,
		...auth,
	});

	if (remaining === 0) {
		await collections.conversationGroups.deleteOne({ _id: groupId });
		return superjsonResponse({ deleted: true });
	}

	// Return updated group with conversations
	const convs = await collections.conversations
		.find({ groupId, ...auth })
		.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model">>({
			title: 1,
			updatedAt: 1,
			model: 1,
		})
		.sort({ updatedAt: -1 })
		.toArray();

	const maxUpdatedAt =
		convs.length > 0
			? new Date(Math.max(...convs.map((c) => c.updatedAt.getTime())))
			: group.updatedAt;

	return superjsonResponse({
		group: {
			id: group._id.toString(),
			name: group.name,
			isCollapsed: group.isCollapsed,
			conversations: convs.map((c) => ({
				id: c._id.toString(),
				title: c.title,
				updatedAt: c.updatedAt,
				model: c.model,
				groupId: group._id.toString(),
			})),
			updatedAt: maxUpdatedAt,
		},
	});
};
