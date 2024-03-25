import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import type { Conversation } from "$lib/types/Conversation";

const NUM_PER_PAGE = 300;

export async function GET({ locals, url }) {
	const p = parseInt(url.searchParams.get("p") ?? "0");

	if (locals.user?._id || locals.sessionId) {
		const convs = await collections.conversations
			.find({
				...authCondition(locals),
			})
			.project<Pick<Conversation, "_id" | "title" | "updatedAt" | "model">>({
				title: 1,
				updatedAt: 1,
				model: 1,
			})
			.sort({ updatedAt: -1 })
			.skip(p * NUM_PER_PAGE)
			.limit(NUM_PER_PAGE)
			.toArray();

		const res = convs.map((conv) => ({
			id: conv._id,
			title: conv.title,
			updatedAt: conv.updatedAt,
			modelId: conv.model,
		}));

		return Response.json(res);
	} else {
		return Response.json({ message: "Must have session cookie" }, { status: 401 });
	}
}
