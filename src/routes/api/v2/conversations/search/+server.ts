import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import { requireAuth } from "$lib/server/api/utils/requireAuth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import type { Conversation } from "$lib/types/Conversation";
import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
import { buildSnippet } from "$lib/utils/snippet";

const MIN_QUERY_LENGTH = 2;
const MESSAGE_SLICE = 8;

export const GET: RequestHandler = async ({ locals, url }) => {
	requireAuth(locals);

	const q = (url.searchParams.get("q") ?? "").trim();
	const p = parseInt(url.searchParams.get("p") ?? "0") || 0;

	if (q.length < MIN_QUERY_LENGTH) {
		return superjsonResponse({ conversations: [], hasMore: false });
	}

	const pageSize = CONV_NUM_PER_PAGE;

	const convs = await collections.conversations
		.find({
			...authCondition(locals),
			$text: { $search: q },
		})
		.project<
			Pick<Conversation, "_id" | "title" | "updatedAt" | "model"> & {
				messages: Pick<Conversation["messages"][number], "content">[];
			}
		>({
			title: 1,
			updatedAt: 1,
			model: 1,
			messages: { $slice: MESSAGE_SLICE },
			"messages.content": 1,
		})
		.sort({ updatedAt: -1 })
		.skip(p * pageSize)
		.limit(pageSize + 1)
		.toArray();

	const hasMore = convs.length > pageSize;
	const page = hasMore ? convs.slice(0, pageSize) : convs;

	const res = page.map((conv) => {
		const haystack = [conv.title, ...(conv.messages ?? []).map((m) => m.content ?? "")]
			.filter(Boolean)
			.join(" \n ");
		const { snippet, matchedText } = buildSnippet(haystack, q);

		return {
			_id: conv._id,
			id: conv._id,
			title: conv.title,
			updatedAt: conv.updatedAt,
			model: conv.model,
			modelId: conv.model,
			description: snippet,
			matchedText,
		};
	});

	return superjsonResponse({ conversations: res, hasMore });
};
