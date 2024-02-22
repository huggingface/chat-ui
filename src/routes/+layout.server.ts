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
	SEARXNG_QUERY_URL,
	ENABLE_ASSISTANTS,
} from "$env/static/private";
import { ObjectId } from "mongodb";
import type { ConvSidebar } from "$lib/types/ConvSidebar";

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends(UrlDependency.ConversationList);

	const settings = await collections.settings.findOne(authCondition(locals));

	// If the active model in settings is not valid, set it to the default model. This can happen if model was disabled.
	if (
		settings &&
		!validateModel(models).safeParse(settings?.activeModel).success &&
		!settings.assistants?.map((el) => el.toString())?.includes(settings?.activeModel)
	) {
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

	const enableAssistants = ENABLE_ASSISTANTS === "true";

	const assistantActive = !models.map(({ id }) => id).includes(settings?.activeModel ?? "");

	const assistant = assistantActive
		? JSON.parse(
				JSON.stringify(
					await collections.assistants.findOne({
						_id: new ObjectId(settings?.activeModel),
					})
				)
		  )
		: null;

	const conversations = await collections.conversations
		.find(authCondition(locals))
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
		.limit(300)
		.toArray();

	const userAssistants = settings?.assistants?.map((assistantId) => assistantId.toString()) ?? [];
	const userAssistantsSet = new Set(userAssistants);

	const assistantIds = [
		...userAssistants.map((el) => new ObjectId(el)),
		...(conversations.map((conv) => conv.assistantId).filter((el) => !!el) as ObjectId[]),
	];

	const assistants = await collections.assistants.find({ _id: { $in: assistantIds } }).toArray();

	const messagesBeforeLogin = MESSAGES_BEFORE_LOGIN ? parseInt(MESSAGES_BEFORE_LOGIN) : 0;

	let loginRequired = false;

	if (requiresUser && !locals.user && messagesBeforeLogin) {
		if (conversations.length > messagesBeforeLogin) {
			loginRequired = true;
		} else {
			// get the number of messages where `from === "assistant"` across all conversations.
			const totalMessages =
				(
					await collections.conversations
						.aggregate([
							{ $match: { ...authCondition(locals), "messages.from": "assistant" } },
							{ $project: { messages: 1 } },
							{ $limit: messagesBeforeLogin + 1 },
							{ $unwind: "$messages" },
							{ $match: { "messages.from": "assistant" } },
							{ $count: "messages" },
						])
						.toArray()
				)[0]?.messages ?? 0;

			loginRequired = totalMessages > messagesBeforeLogin;
		}
	}

	return {
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
		settings: {
			searchEnabled: !!(
				SERPAPI_KEY ||
				SERPER_API_KEY ||
				SERPSTACK_API_KEY ||
				YDC_API_KEY ||
				USE_LOCAL_WEBSEARCH ||
				SEARXNG_QUERY_URL
			),
			ethicsModalAccepted: !!settings?.ethicsModalAcceptedAt,
			ethicsModalAcceptedAt: settings?.ethicsModalAcceptedAt ?? null,
			activeModel: settings?.activeModel ?? DEFAULT_SETTINGS.activeModel,
			hideEmojiOnSidebar: settings?.hideEmojiOnSidebar ?? false,
			shareConversationsWithModelAuthors:
				settings?.shareConversationsWithModelAuthors ??
				DEFAULT_SETTINGS.shareConversationsWithModelAuthors,
			customPrompts: settings?.customPrompts ?? {},
			assistants: userAssistants,
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
			logoUrl: model.logoUrl,
			promptExamples: model.promptExamples,
			parameters: model.parameters,
			preprompt: model.preprompt,
			multimodal: model.multimodal,
			unlisted: model.unlisted,
		})),
		oldModels,
		assistants: assistants
			.filter((el) => userAssistantsSet.has(el._id.toString()))
			.map((el) => ({
				...el,
				_id: el._id.toString(),
				createdById: undefined,
				createdByMe:
					el.createdById.toString() === (locals.user?._id ?? locals.sessionId).toString(),
			})),
		user: locals.user && {
			id: locals.user._id.toString(),
			username: locals.user.username,
			avatarUrl: locals.user.avatarUrl,
			email: locals.user.email,
		},
		assistant,
		enableAssistants,
		loginRequired,
		loginEnabled: requiresUser,
		guestMode: requiresUser && messagesBeforeLogin > 0,
	};
};
