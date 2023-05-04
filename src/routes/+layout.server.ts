import type { LayoutServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { UrlDependency } from "$lib/types/UrlDependency";
import { defaultModel, models } from "$lib/server/models";

export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
	const { conversations } = collections;

	depends(UrlDependency.ConversationList);

	const settings = await collections.settings.findOne({ sessionId: locals.sessionId });

	return {
		conversations: await conversations
			.find({
				sessionId: locals.sessionId,
			})
			.sort({ updatedAt: -1 })
			.project<Pick<Conversation, "title" | "model" | "_id" | "updatedAt" | "createdAt">>({
				title: 1,
				model: 1,
				_id: 1,
				updatedAt: 1,
				createdAt: 1,
			})
			.map((conv) => ({
				id: conv._id.toString(),
				title: conv.title,
				model: conv.model ?? defaultModel,
			}))
			.toArray(),
		settings: {
			shareConversationsWithModelAuthors: settings?.shareConversationsWithModelAuthors ?? true,
			ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,
			activeModel: url.searchParams.get("model") ?? settings?.activeModel ?? defaultModel.name,
		},
		models: models.map((model) => ({
			name: model.name,
			websiteUrl: model.websiteUrl,
			datasetName: model.datasetName,
			displayName: model.displayName,
			description: model.description,
			promptExamples: model.promptExamples,
			parameters: model.parameters,
		})),
	};
};
