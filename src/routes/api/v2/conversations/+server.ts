import type { RequestHandler } from "@sveltejs/kit";
import type { ObjectId } from "mongodb";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { deleteMlFilesOf } from "$lib/server/mlFiles/store";
import { deleteMlRegistry } from "$lib/server/mlRegistry/store";
import { authCondition } from "$lib/server/auth";
import type { Conversation } from "$lib/types/Conversation";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAuth(locals);

	const pageSize = CONV_NUM_PER_PAGE;
	const p = parseInt(url.searchParams.get("p") ?? "0") || 0;

	const convs = await collections.conversations
		.find(authCondition(locals))
		.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model" | "mlAssistant">>({
			title: 1,
			updatedAt: 1,
			model: 1,
			mlAssistant: 1,
		})
		.sort({ updatedAt: -1 })
		.skip(p * pageSize)
		.limit(pageSize + 1)
		.toArray();

	const hasMore = convs.length > pageSize;
	const res = (hasMore ? convs.slice(0, pageSize) : convs).map((conv) => ({
		_id: conv._id,
		id: conv._id, // legacy param iOS
		title: conv.title,
		updatedAt: conv.updatedAt,
		model: conv.model,
		modelId: conv.model, // legacy param iOS
		...(conv.mlAssistant ? { mlAssistant: true } : {}),
	}));

	return superjsonResponse({ conversations: res, hasMore });
};

export const DELETE: RequestHandler = async ({ locals }) => {
	requireAuth(locals);

	const ids = await collections.conversations
		.find(authCondition(locals))
		.project<{ _id: ObjectId }>({ _id: 1 })
		.map((conv) => conv._id)
		.toArray();
	const res = await collections.conversations.deleteMany({ _id: { $in: ids } });
	await deleteMlRegistry(ids);
	await deleteMlFilesOf(ids);

	return superjsonResponse(res.deletedCount);
};
