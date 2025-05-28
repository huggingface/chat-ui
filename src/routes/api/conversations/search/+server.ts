import { CONV_NUM_PER_PAGE } from "$lib/constants/pagination";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import type { RequestHandler } from "@sveltejs/kit";

export type GETSearchEndpointReturn = Array<{
	id: string;
	title: string;
	updatedAt: Date;
	model: string;
	assistantId?: string;
	mdoelTools?: boolean;
}>;

export const GET: RequestHandler = async ({ locals, url }) => {
	const searchQuery = url.searchParams.get("q");
	const p = parseInt(url.searchParams.get("p") ?? "0");

	if (!searchQuery || searchQuery.length < 3) {
		return Response.json([]);
	}

	if (locals.user?._id || locals.sessionId) {
		const convs = await collections.conversations
			.find({
				sessionId: undefined,
				...authCondition(locals),
				$text: { $search: searchQuery },
			})
			.sort({ score: { $meta: "textScore" } })
			.project({
				title: 1,
				updatedAt: 1,
				model: 1,
				assistantId: 1,
				messages: 1,
				userId: 1,
			})
			.skip(p * CONV_NUM_PER_PAGE)
			.limit(CONV_NUM_PER_PAGE)
			.toArray()
			.then((convs) =>
				convs.map((conv) => {
					return {
						_id: conv._id,
						id: conv._id, // legacy param iOS
						title: conv.title,
						updatedAt: conv.updatedAt,
						model: conv.model,
						assistantId: conv.assistantId,
						modelTools: models.find((m) => m.id == conv.model)?.tools ?? false,
					};
				})
			);

		return Response.json(convs as GETSearchEndpointReturn);
	}
	return Response.json([]);
};
