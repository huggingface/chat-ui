import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { UrlDependency } from "$lib/types/UrlDependency";
import { defaultModel, models, oldModels, validateModel } from "$lib/server/models";
import { authCondition } from "$lib/server/auth";

export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
	const { conversations } = collections;
	const urlModel = url.searchParams.get("model");

	depends(UrlDependency.ConversationList);

	if (urlModel) {
		const isValidModel = validateModel(models).safeParse(urlModel).success;

		if (isValidModel) {
			await collections.settings.updateOne(
				authCondition(locals),
				{ $set: { activeModel: urlModel } },
				{ upsert: true }
			);
		}

		throw redirect(302, url.pathname);
	}

	const settings = await collections.settings.findOne(authCondition(locals));

	// If the active model in settings is not valid, set it to the default model. This can happen if model was disabled.
	if (settings && !validateModel(models).safeParse(settings?.activeModel).success) {
		settings.activeModel = defaultModel.id;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	return {
		conversations: await conversations
			.find(authCondition(locals))
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
			activeModel: settings?.activeModel ?? defaultModel.id,
		},
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			websiteUrl: model.websiteUrl,
			datasetName: model.datasetName,
			displayName: model.displayName,
			description: model.description,
			promptExamples: model.promptExamples,
			parameters: model.parameters,
		})),
		oldModels,
	};
};
