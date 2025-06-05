import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { jsonSerialize } from "../lib/utils/serialize";
import { useAPIClient, throwOnError, throwOnErrorNullable } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

export const load = async ({ depends, fetch }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch });

	const [
		settings,
		models,
		assistants,
		oldModels,
		tools,
		communityToolCount,
		user,
		publicConfig,
		featureFlags,
		conversationsData,
	] = await Promise.all([
		client.user.settings.get().then(throwOnError),
		client.models.get().then(throwOnError),
		client.user.assistants.get().then(throwOnError),
		client.models.old.get().then(throwOnError),
		client.tools.active.get().then(throwOnError),
		client.tools.count.get().then(throwOnError),
		client.user.get().then(throwOnErrorNullable),
		client["public-config"].get().then(throwOnError),
		client["feature-flags"].get().then(throwOnError),
		client.conversations.get({ query: { p: 0 } }).then(throwOnError),
	]);

	const defaultModel = models[0];

	const assistantActive = !models.map(({ id }) => id).includes(settings?.activeModel ?? "");

	const { conversations: rawConversations, nConversations } = conversationsData;
	const conversations = rawConversations.map((conv) => {
		if (settings?.hideEmojiOnSidebar) {
			conv.title = conv.title.replace(/\p{Emoji}/gu, "");
		}

		// remove invalid unicode and trim whitespaces
		conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();

		return {
			id: conv._id.toString(),
			title: conv.title,
			model: conv.model ?? defaultModel,
			updatedAt: new Date(conv.updatedAt),
			...(conv.assistantId
				? {
						assistantId: conv.assistantId.toString(),
						avatarUrl: client
							.assistants({ id: conv.assistantId.toString() })
							.get()
							.then(throwOnErrorNullable)
							.then((assistant) => {
								if (!assistant.avatar) {
									return undefined;
								}
							}),
					}
				: {}),
		} satisfies ConvSidebar;
	});

	return {
		nConversations,
		conversations,
		assistant: assistantActive
			? await client
					.assistants({ id: settings?.activeModel })
					.get()
					.then(throwOnErrorNullable)
					.then(jsonSerialize)
					.catch(() => undefined)
			: undefined,
		assistants,
		models,
		oldModels,
		tools,
		communityToolCount,
		user,
		settings: {
			...settings,
			ethicsModalAcceptedAt: settings.ethicsModalAcceptedAt
				? new Date(settings.ethicsModalAcceptedAt)
				: null,
		},
		publicConfig: getConfigManager(publicConfig),
		...featureFlags,
	};
};
