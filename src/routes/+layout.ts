import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
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
		client.user.settings.get().then(handleResponse),
		client.models.get().then(handleResponse),
		client.user.assistants.get().then(handleResponse),
		client.models.old.get().then(handleResponse),
		client.tools.active.get().then(handleResponse),
		client.tools.count.get().then(handleResponse),
		client.user.get().then(handleResponse),
		client["public-config"].get().then(handleResponse),
		client["feature-flags"].get().then(handleResponse),
		client.conversations.get({ query: { p: 0 } }).then(handleResponse),
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
							.then(handleResponse)
							.then((assistant) => {
								if (!assistant || !assistant.avatar) {
									return undefined;
								}
								return `/settings/assistants/${conv.assistantId}/avatar.jpg?hash=${assistant.avatar}`;
							})
							.catch(() => undefined),
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
					.then(handleResponse)
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
