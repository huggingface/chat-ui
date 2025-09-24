import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	const [settings, models, oldModels, user, publicConfig, featureFlags, conversationsData] =
		await Promise.all([
			client.user.settings.get().then(handleResponse),
			client.models.get().then(handleResponse),
			client.models.old.get().then(handleResponse),
			client.user.get().then(handleResponse),
			client["public-config"].get().then(handleResponse),
			client["feature-flags"].get().then(handleResponse),
			client.conversations.get({ query: { p: 0 } }).then(handleResponse),
		]);

	const defaultModel = models[0];

	const { conversations: rawConversations, nConversations } = conversationsData;
	const conversations = rawConversations.map((conv) => {
		// Always strip emojis and <think> markers from titles for sidebar display
		conv.title = conv.title.replace(/\p{Emoji}/gu, "");
		conv.title = conv.title.replace(/<\/?think>/gi, "");

		// remove invalid unicode and trim whitespaces
		conv.title = conv.title.replace(/\uFFFD/gu, "").trimStart();

		return {
			id: conv._id.toString(),
			title: conv.title,
			model: conv.model ?? defaultModel,
			updatedAt: new Date(conv.updatedAt),
		} satisfies ConvSidebar;
	});

	return {
		nConversations,
		conversations,
		models,
		oldModels,
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
