import type { RequestHandler } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { ObjectId } from "mongodb";
import { defaultModel } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";
import type { ConvSidebar } from "$lib/types/ConvSidebar";

export const GET: RequestHandler = async ({ url, locals }) => {
	const settings = await collections.settings.findOne(authCondition(locals));
	const limit = parseInt(url.searchParams.get("limit") ?? "300");
	const skip = parseInt(url.searchParams.get("skip") ?? "50");

	const conversations = await collections.conversations
		.find(authCondition(locals))
		.skip(skip)
		.sort({ updatedAt: -1 })
		.project<
			Pick<Conversation, "title" | "model" | "_id" | "updatedAt" | "createdAt" | "assistantId">
		>({
			title: 1,
			model: 1,
			_id: 1,
			updatedAt: 1,
			createdAt: 1,
			assistantId: 1,
		})
		.limit(limit)
		.toArray();

	const userAssistants = settings?.assistants?.map((assistantId) => assistantId.toString()) ?? [];

	const assistantIds = [
		...userAssistants.map((el) => new ObjectId(el)),
		...(conversations.map((conv) => conv.assistantId).filter((el) => !!el) as ObjectId[]),
	];

	const assistants = await collections.assistants.find({ _id: { $in: assistantIds } }).toArray();

	return new Response(
		JSON.stringify({
			conversations: conversations.map((conv) => {
				if (settings?.hideEmojiOnSidebar) {
					conv.title = conv.title.replace(/\p{Emoji}/gu, "");
				}

				// remove invalid unicode and trim whitespaces
				conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();

				return {
					id: conv._id.toString(),
					title: conv.title,
					model: conv.model ?? defaultModel,
					updatedAt: conv.updatedAt,
					assistantId: conv.assistantId?.toString(),
					avatarHash:
						conv.assistantId &&
						assistants.find((a) => a._id.toString() === conv.assistantId?.toString())?.avatar,
				};
			}) satisfies ConvSidebar[],
		}),
		{ headers: { "Content-Type": "application/json" } }
	);
};
