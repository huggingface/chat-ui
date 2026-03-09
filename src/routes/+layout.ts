import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { DEFAULT_SETTINGS } from "$lib/types/Settings";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

async function withFallback<T>(promise: Promise<T>, fallback: T): Promise<T> {
	try {
		return await promise;
	} catch {
		return fallback;
	}
}

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	const [settings, models, user, publicConfig, featureFlags, conversationsData] = await Promise.all(
		[
			withFallback(client.user.settings.get().then(handleResponse), {
				...DEFAULT_SETTINGS,
				welcomeModalSeen: false,
				welcomeModalSeenAt: null,
			}),
			withFallback(client.models.get().then(handleResponse), []),
			withFallback(client.user.get().then(handleResponse), null),
			client["public-config"].get().then(handleResponse),
			withFallback(client["feature-flags"].get().then(handleResponse), {
				enableAssistants: false,
				loginEnabled: false,
				isAdmin: false,
			}),
			withFallback(client.conversations.get({ query: { p: 0 } }).then(handleResponse), {
				conversations: [],
				nConversations: 0,
			}),
		]
	);

	const defaultModel = models[0];

	const { conversations: rawConversations, nConversations } = conversationsData;
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
		nConversations,
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
