import type { ConvSidebar } from "$lib/types/ConvSidebar";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";
import type { GETModelsResponse, FeatureFlags } from "$lib/server/api/types";
import { base } from "$app/paths";

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
	artifactsOverrides: Record<string, boolean>;
	hidePromptExamples: Record<string, boolean>;
	providerOverrides: Record<string, string>;
	reasoningEffortOverrides: Record<string, "low" | "medium" | "high">;
	reasoningOverrides: Record<string, boolean>;
	billingOrganization?: string;
}

export const load = async ({ fetch, url }) => {
	const client = useAPIClient({ fetch, origin: url.origin });

	// Fetch the MCP base-server list alongside the other layout data.
	// During SSR, SvelteKit's fetch intercepts same-origin requests and serves
	// them directly from the handler — no real HTTP round-trip. The result is
	// inlined in the SSR payload so the client has it before any onMount fires,
	// allowing +layout.svelte to pre-populate the mcpServers store synchronously
	// and eliminate the mcpServersLoaded gate delay on first message.
	const [settings, models, user, publicConfig, featureFlags, conversationsData, mcpBaseServers] =
		(await Promise.all([
			client.user.settings.get().then(handleResponse),
			client.models.get().then(handleResponse),
			client.user.get().then(handleResponse),
			client["public-config"].get().then(handleResponse),
			client["feature-flags"].get().then(handleResponse),
			client.conversations.get({ query: { p: 0 } }).then(handleResponse),
			fetch(`${url.origin}${base}/api/mcp/servers`)
				.then((r) => (r.ok ? r.json() : []))
				.catch(() => []),
		])) as [
			SettingsResponse,
			GETModelsResponse,
			UserInfo | null,
			Record<string, unknown>,
			FeatureFlags,
			{ conversations: ConversationListItem[]; hasMore: boolean },
			import("$lib/types/Tool").MCPServer[],
		];

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
		publicConfig: getConfigManager(publicConfig as Record<`PUBLIC_${string}`, string>),
		mcpBaseServers,
		...featureFlags,
	};
};
