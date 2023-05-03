import type { LayoutServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { UrlDependency } from "$lib/types/UrlDependency";
import { modelNames } from "$lib/server/models";

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	const { conversations } = collections;

	depends(UrlDependency.ConversationList);
	depends(UrlDependency.Settings);

	const settings = await collections.settings.findOne({ sessionId: locals.sessionId });

	return {
		conversations: await conversations
			.find({
				sessionId: locals.sessionId,
			})
			.sort({ updatedAt: -1 })
			.project<Pick<Conversation, "title" | "_id" | "updatedAt" | "createdAt">>({
				title: 1,
				_id: 1,
				updatedAt: 1,
				createdAt: 1,
			})
			.map((conv) => ({ id: conv._id.toString(), title: conv.title }))
			.toArray(),
		settings: {
			shareConversationsWithModelAuthors: settings?.shareConversationsWithModelAuthors ?? true,
			ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,
		},
		models: modelNames,
	};
};
