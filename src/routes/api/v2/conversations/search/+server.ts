import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import type { Conversation } from "$lib/types/Conversation";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";

const MIN_QUERY_LENGTH = 3;

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAuth(locals);

	const searchQuery = (url.searchParams.get("q") ?? "").trim();
	const p = parseInt(url.searchParams.get("p") ?? "0") || 0;

	if (searchQuery.length < MIN_QUERY_LENGTH) {
		return superjsonResponse({ conversations: [], hasMore: false });
	}

	const pageSize = CONV_NUM_PER_PAGE;

	const convs = await collections.conversations
		.find({
			...authCondition(locals),
			$text: { $search: searchQuery },
		})
		.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model">>({
			title: 1,
			updatedAt: 1,
			model: 1,
			score: { $meta: "textScore" },
		})
		.sort({ score: { $meta: "textScore" } })
		.skip(p * pageSize)
		.limit(pageSize + 1)
		.toArray();

	const hasMore = convs.length > pageSize;
	const res = (hasMore ? convs.slice(0, pageSize) : convs).map((conv) => ({
		_id: conv._id,
		id: conv._id,
		title: conv.title,
		updatedAt: conv.updatedAt,
		model: conv.model,
	}));

	return superjsonResponse({ conversations: res, hasMore });
};
