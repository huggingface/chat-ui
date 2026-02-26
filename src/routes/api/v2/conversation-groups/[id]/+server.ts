import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { error } from "@sveltejs/kit";

const patchSchema = z.object({
	name: z.string().min(1).optional(),
	isCollapsed: z.boolean().optional(),
});

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid group ID");
	}
	const groupId = new ObjectId(id);
	const body = patchSchema.parse(await request.json());

	const update: Record<string, unknown> = {};
	if (body.name !== undefined) update.name = body.name;
	if (body.isCollapsed !== undefined) update.isCollapsed = body.isCollapsed;

	if (Object.keys(update).length === 0) {
		error(400, "No fields to update");
	}

	const result = await collections.conversationGroups.updateOne(
		{ _id: groupId, ...authCondition(locals) },
		{ $set: { ...update, updatedAt: new Date() } }
	);

	if (result.matchedCount === 0) {
		error(404, "Group not found");
	}

	return superjsonResponse({ success: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	requireAuth(locals);

	const id = params.id ?? "";
	if (!ObjectId.isValid(id)) {
		error(400, "Invalid group ID");
	}
	const groupId = new ObjectId(id);

	// Unset groupId on all conversations in this group
	await collections.conversations.updateMany(
		{ groupId, ...authCondition(locals) },
		{ $unset: { groupId: "" } }
	);

	const result = await collections.conversationGroups.deleteOne({
		_id: groupId,
		...authCondition(locals),
	});

	if (result.deletedCount === 0) {
		error(404, "Group not found");
	}

	return superjsonResponse({ success: true });
};
