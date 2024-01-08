import type { LayoutServerLoad } from "./$types";
import { collections } from "$lib/server/database";
import type { Conversation } from "$lib/types/Conversation";
import { UrlDependency } from "$lib/types/UrlDependency";
import { defaultModel, models, oldModels, validateModel } from "$lib/server/models";
import { authCondition, requiresUser } from "$lib/server/auth";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import {
	SERPAPI_KEY,
	SERPER_API_KEY,
	SERPSTACK_API_KEY,
	MESSAGES_BEFORE_LOGIN,
	YDC_API_KEY,
	USE_LOCAL_WEBSEARCH,
} from "$env/static/private";

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	const { conversations } = collections;
	depends(UrlDependency.ConversationList);

	const settings = await collections.settings.findOne(authCondition(locals));

	// If the active model in settings is not valid, set it to the default model. This can happen if model was disabled.
	if (settings && !validateModel(models).safeParse(settings?.activeModel).success) {
		settings.activeModel = defaultModel.id;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	// if the model is unlisted, set the active model to the default model
	if (
		settings?.activeModel &&
		models.find((m) => m.id === settings?.activeModel)?.unlisted === true
	) {
		settings.activeModel = defaultModel.id;
		await collections.settings.updateOne(authCondition(locals), {
			$set: { activeModel: defaultModel.id },
		});
	}

	// get the number of messages where `from === "assistant"` across all conversations.
	const totalMessages =
		(
			await conversations
				.aggregate([
					{ $match: authCondition(locals) },
					{ $project: { messages: 1 } },
					{ $unwind: "$messages" },
					{ $match: { "messages.from": "assistant" } },
					{ $count: "messages" },
				])
				.toArray()
		)[0]?.messages ?? 0;

	const messagesBeforeLogin = MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0;

	const userHasExceededMessages = messagesBeforeLogin > 0 && totalMessages > messagesBeforeLogin;

	const loginRequired = requiresUser && !locals.user && userHasExceededMessages;

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
			.map((conv) => {
				// remove emojis if settings say so
				if (settings?.hideEmojiOnSidebar) {
					conv.title = conv.title.replace(/\p{Emoji}/gu, "");
				}

				// remove invalid unicode and trim whitespaces
				conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();
				return {
					id: conv._id.toString(),
					title: settings?.hideEmojiOnSidebar ? conv.title.replace(/\p{Emoji}/gu, "") : conv.title,
					model: conv.model ?? defaultModel,
					updatedAt: conv.updatedAt,
				};
			})
			.toArray(),
		settings: {
			searchEnabled: !!(
				SERPAPI_KEY ||
				SERPER_API_KEY ||
				SERPSTACK_API_KEY ||
				YDC_API_KEY ||
				USE_LOCAL_WEBSEARCH
			),
			ethicsModalAccepted: !!settings?.ethicsModalAcceptedAt,
			ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,
			activeModel: settings?.activeModel ?? DEFAULT_SETTINGS.activeModel,
			hideEmojiOnSidebar: settings?.hideEmojiOnSidebar ?? false,
			shareConversationsWithModelAuthors:
				settings?.shareConversationsWithModelAuthors ??
				DEFAULT_SETTINGS.shareConversationsWithModelAuthors,
			customPrompts: settings?.customPrompts ?? {},
		},
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			websiteUrl: model.websiteUrl,
			modelUrl: model.modelUrl,
			datasetName: model.datasetName,
			datasetUrl: model.datasetUrl,
			displayName: model.displayName,
			description: model.description,
			promptExamples: model.promptExamples,
			parameters: model.parameters,
			preprompt: model.preprompt,
			multimodal: model.multimodal,
			unlisted: model.unlisted,
		})),
		oldModels,
		user: locals.user && {
			username: locals.user.username,
			avatarUrl: locals.user.avatarUrl,
			email: locals.user.email,
		},
		loginRequired,
		loginEnabled: requiresUser,
		guestMode: requiresUser && messagesBeforeLogin > 0,
	};
};
