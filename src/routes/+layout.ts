import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";

async function withFallback<T>(promise: Promise<T>, fallback: T): Promise<T> {
	try {
		return await promise;
	} catch {
		return fallback;
	}
}

const DEFAULT_LAYOUT_SETTINGS = {
	welcomeModalSeen: false,
	welcomeModalSeenAt: null,
	activeModel: "",
	disableStream: false,
	directPaste: false,
	hidePromptExamples: {},
	shareConversationsWithModelAuthors: true,
	customPrompts: {},
	multimodalOverrides: {},
	toolsOverrides: {},
};

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	const [settings, models, user, publicConfig, featureFlags, conversationsData, projectsData] =
		await Promise.all([
			withFallback(client.user.settings.get().then(handleResponse), DEFAULT_LAYOUT_SETTINGS),
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
			withFallback(client.projects.get().then(handleResponse), { projects: [] }),
		]);

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
			projectId: conv.projectId?.toString(),
		} satisfies ConvSidebar;
	});

	const projects = (projectsData.projects ?? []).map(
		(p: {
			_id: { toString(): string };
			name: string;
			description?: string;
			preprompt?: string;
			modelId?: string;
			updatedAt: string | Date;
			conversationCount: number;
		}) => ({
			id: p._id.toString(),
			name: p.name,
			description: p.description,
			preprompt: p.preprompt,
			modelId: p.modelId,
			updatedAt: new Date(p.updatedAt),
			conversationCount: p.conversationCount,
		})
	);

	return {
		nConversations,
		conversations,
		projects,
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
