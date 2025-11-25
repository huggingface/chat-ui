import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	const [settings, models, user, publicConfig, featureFlags, conversationsData] = await Promise.all(
		[
			client.user.settings.get().then(handleResponse),
			client.models.get().then(handleResponse),
			client.user.get().then(handleResponse),
			client["public-config"].get().then(handleResponse),
			client["feature-flags"].get().then(handleResponse),
			client.conversations.get({ query: { p: 0 } }).then(handleResponse),
		]
	);

	const defaultModel = models[0];

	const { conversations: rawConversations } = conversationsData;
	const conversations = rawConversations.map((conv) => {
		const trimmedTitle = conv.title.trim();

		conv.title = trimmedTitle;

		return {
			id: conv._id.toString(),
			title: conv.title,
			model: conv.model ?? defaultModel,
			updatedAt: new Date(conv.updatedAt),
		} satisfies ConvSidebar;
	});

	return {
		conversations,
		models,
		oldModels: [],
		user,
		settings: {
			...settings,
			welcomeModalSeenAt: settings.welcomeModalSeenAt
				? new Date(settings.welcomeModalSeenAt)
				: null,
		},
		publicConfig: getConfigManager(publicConfig),
		...featureFlags,
	};
};
