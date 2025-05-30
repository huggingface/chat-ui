import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { models } from "$lib/server/models";
import type { Message } from "$lib/types/Message";
import type { RequestHandler } from "@sveltejs/kit";

export type GETSearchEndpointReturn = Array<{
	id: string;
	title: string;
	content: string;
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
				userId: undefined,
				...authCondition(locals),
				$text: { $search: searchQuery },
			})
			.sort({
				updatedAt: -1, // Sort by date updated in descending order
			})
			.project({
				title: 1,
				updatedAt: 1,
				model: 1,
				assistantId: 1,
				messages: 1,
				userId: 1,
			})
			.skip(p * 5)
			.limit(5)
			.toArray()
			.then((convs) =>
				convs.map((conv) => {
					// The first match of the inut user is searching for
					const searchQueryMatch = conv.messages.findIndex((message: Message) =>
						message.content.includes(searchQuery)
					);

					// First AI Response to searchQueryMatch
					const assistantResponse =
						searchQueryMatch >= 0 &&
						searchQueryMatch < conv.messages.length &&
						conv.messages[searchQueryMatch].from === "assistant"
							? conv.messages[searchQueryMatch].content
							: searchQueryMatch + 1 < conv.messages.length
								? conv.messages[searchQueryMatch + 1].content
								: "";

					return {
						_id: conv._id,
						id: conv._id, // legacy param iOS
						title: conv.title,
						content: assistantResponse,
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
