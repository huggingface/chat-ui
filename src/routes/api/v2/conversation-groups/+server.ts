import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { error } from "@sveltejs/kit";
import { generateGroupName } from "$lib/server/textGeneration/groupName";
import type { Conversation } from "$lib/types/Conversation";
import type { ConvGroupSidebar } from "$lib/types/ConvGroupSidebar";

export const GET: RequestHandler = async ({ locals }) => {
	requireAuth(locals);

	const groups = await collections.conversationGroups
		.find(authCondition(locals))
		.sort({ updatedAt: -1 })
		.toArray();

	const groupsWithConvs: ConvGroupSidebar[] = await Promise.all(
		groups.map(async (group) => {
			const convs = await collections.conversations
				.find({
					groupId: group._id,
					...authCondition(locals),
				})
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

			return {
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
			};
		})
	);

	return superjsonResponse({ groups: groupsWithConvs });
};

const createSchema = z.object({
	conversationIds: z.array(z.string()).min(2),
	name: z.string().optional(),
});

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);

	const body = createSchema.parse(await request.json());
	const convObjectIds = body.conversationIds.map((id) => new ObjectId(id));

	// Verify all conversations belong to the user
	const count = await collections.conversations.countDocuments({
		_id: { $in: convObjectIds },
		...authCondition(locals),
	});

	if (count !== convObjectIds.length) {
		error(404, "One or more conversations not found");
	}

	const now = new Date();
	const auth = authCondition(locals);
	const groupDoc = {
		_id: new ObjectId(),
		...auth,
		name: body.name ?? "New Group",
		isCollapsed: false,
		createdAt: now,
		updatedAt: now,
	} as import("$lib/types/ConversationGroup").ConversationGroup;

	await collections.conversationGroups.insertOne(groupDoc);

	// Unset groupId from any previous groups and set the new one
	await collections.conversations.updateMany(
		{ _id: { $in: convObjectIds }, ...authCondition(locals) },
		{ $set: { groupId: groupDoc._id } }
	);

	// Fetch the conversations for the response
	const convs = await collections.conversations
		.find({ groupId: groupDoc._id, ...authCondition(locals) })
		.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model">>({
			title: 1,
			updatedAt: 1,
			model: 1,
		})
		.sort({ updatedAt: -1 })
		.toArray();

	const maxUpdatedAt =
		convs.length > 0 ? new Date(Math.max(...convs.map((c) => c.updatedAt.getTime()))) : now;

	const group: ConvGroupSidebar = {
		id: groupDoc._id.toString(),
		name: groupDoc.name,
		isCollapsed: false,
		conversations: convs.map((c) => ({
			id: c._id.toString(),
			title: c.title,
			updatedAt: c.updatedAt,
			model: c.model,
			groupId: groupDoc._id.toString(),
		})),
		updatedAt: maxUpdatedAt,
	};

	// Generate name in the background if none was provided
	if (!body.name) {
		const titles = convs.map((c) => c.title);
		generateGroupName(titles, locals).then(async (name) => {
			if (name) {
				await collections.conversationGroups.updateOne({ _id: groupDoc._id }, { $set: { name } });
			}
		});
	}

	return superjsonResponse({ group }, { status: 201 });
};
