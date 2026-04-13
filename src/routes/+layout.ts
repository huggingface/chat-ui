import { UrlDependency } from "$lib/types/UrlDependency";
import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";
import type { GETModelsResponse, FeatureFlags } from "$lib/server/api/types";

async function withFallback<T>(
	promise: Promise<T>,
	fallback: T,
	label?: string
): Promise<{ value: T; isFallback: boolean }> {
	try {
		return { value: await promise, isFallback: false };
	} catch (e) {
		console.warn(`[layout] ${label ?? "API call"} failed, using fallback:`, e);
		return { value: fallback, isFallback: true };
	}
}

interface ConversationListItem {
	_id: { toString(): string };
	title: string;
	updatedAt: Date | string;
	model?: string;
}

interface UserInfo {
	id: string;
	username?: string;
	avatarUrl?: string;
	email?: string;
	isAdmin: boolean;
	isEarlyAccess: boolean;
}

interface SettingsResponse {
	welcomeModalSeen: boolean;
	welcomeModalSeenAt: Date | null;
	shareConversationsWithModelAuthors: boolean;
	activeModel: string;
	streamingMode: "raw" | "smooth";
	directPaste: boolean;
	hapticsEnabled: boolean;
	customPrompts: Record<string, string>;
	customPromptsEnabled: Record<string, boolean>;
	multimodalOverrides: Record<string, boolean>;
	toolsOverrides: Record<string, boolean>;
	hidePromptExamples: Record<string, boolean>;
	providerOverrides: Record<string, string>;
	billingOrganization?: string;
}

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	const [settingsResult, modelsResult, userResult, publicConfig, featureFlagsResult, conversationsResult] =
		await Promise.all([
			withFallback(
				client.user.settings.get().then(handleResponse),
				{
					welcomeModalSeen: false,
					welcomeModalSeenAt: null,
					shareConversationsWithModelAuthors: true,
					activeModel: "",
					streamingMode: "smooth" as const,
					directPaste: false,
					hapticsEnabled: false,
					customPrompts: {},
					multimodalOverrides: {},
					toolsOverrides: {},
					hidePromptExamples: {},
					providerOverrides: {},
				},
				"settings"
			),
			withFallback(
				client.models.get().then(handleResponse),
				[] as unknown as GETModelsResponse,
				"models"
			),
			withFallback(client.user.get().then(handleResponse), null, "user"),
			client["public-config"].get().then(handleResponse),
			withFallback(
				client["feature-flags"].get().then(handleResponse),
				{
					enableAssistants: false,
					loginEnabled: false,
					isAdmin: false,
				} as unknown as FeatureFlags,
				"feature-flags"
			),
			withFallback(
				client.conversations.get({ query: { p: 0 } }).then(handleResponse),
				{
					conversations: [] as ConversationListItem[],
					hasMore: false,
				},
				"conversations"
			),
		]);

	const settings = settingsResult.value as SettingsResponse;
	const settingsIsFallback = settingsResult.isFallback;
	const models = modelsResult.value as GETModelsResponse;
	const user = userResult.value as UserInfo | null;
	const featureFlags = featureFlagsResult.value as FeatureFlags;
	const conversationsData = conversationsResult.value as { conversations: ConversationListItem[]; hasMore: boolean };

	const defaultModel = models[0];

	const { conversations: rawConversations } = conversationsData;
	const conversations = rawConversations.map((conv: ConversationListItem) => {
		const trimmedTitle = conv.title.trim();

		conv.title = trimmedTitle;

		return {
			id: conv._id.toString(),
			title: conv.title,
			model: conv.model ?? defaultModel?.id,
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
		settingsIsFallback,
		publicConfig: getConfigManager(publicConfig as Record<`PUBLIC_${string}`, string>),
		...featureFlags,
	};
};
