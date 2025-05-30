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
				...authCondition(locals),
				userId: undefined,
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

					let matchedContent = "";

					if (searchQueryMatch !== -1) {
						const content = conv.messages[searchQueryMatch].content;
						const queryIndex = content.indexOf(searchQuery);

						// Compute ideal start and end to center the query in the 100 character snippet
						const halfSnippet = 50; // Half of 100 characters
						const queryStart = Math.max(
							0,
							queryIndex - halfSnippet + Math.floor(searchQuery.length / 2)
						);
						const queryEnd = Math.min(content.length, queryStart + 100);

						matchedContent = content.substring(queryStart, queryEnd);

						// Pad if needed (only when content is shorter than 100 chars or too close to start)
						if (matchedContent.length < 100) {
							matchedContent = matchedContent.padEnd(100, " ");
						}
					}

					return {
						_id: conv._id,
						id: conv._id, // legacy param iOS
						title: conv.title,
						content: matchedContent,
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
