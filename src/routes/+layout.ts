import { UrlDependency } from "$lib/types/UrlDependency";
import { useAPIClient, handleResponse } from "$lib/APIClient";
import { getConfigManager } from "$lib/utils/PublicConfig.svelte";
import { browser } from "$app/environment";

// Dummy data for fallback when API calls fail
const dummyModels: Array<{
	id: string;
	name: string;
	displayName: string;
	description?: string;
	logoUrl?: string;
	websiteUrl?: string;
	modelUrl?: string;
	datasetName?: string;
	datasetUrl?: string;
	promptExamples?: Array<{ title: string; prompt: string }>;
	parameters?: Record<string, unknown>;
	preprompt?: string;
	multimodal: boolean;
	multimodalAcceptedMimetypes?: string[];
	unlisted: boolean;
	hasInferenceAPI: boolean;
	isRouter: boolean;
	providers?: Array<Record<string, unknown>>;
}> = [
	{
		id: "dummy-model",
		name: "dummy-model",
		displayName: "Dummy Model",
		description: "A dummy model for testing purposes",
		logoUrl: undefined,
		websiteUrl: "https://huggingface.co",
		modelUrl: "https://huggingface.co",
		datasetName: undefined,
		datasetUrl: undefined,
		promptExamples: [
			{ title: "Example 1", prompt: "Hello, how are you?" },
			{ title: "Example 2", prompt: "What is the weather today?" },
		],
		parameters: {
			temperature: 0.7,
			max_tokens: 1000,
			top_p: 0.9,
		},
		preprompt: "",
		multimodal: false,
		multimodalAcceptedMimetypes: undefined,
		unlisted: false,
		hasInferenceAPI: false,
		isRouter: false,
		providers: undefined,
	},
];

const dummyUser = null;

const dummyPublicConfig: Record<string, string> = {
	PUBLIC_APP_NAME: "Chat UI",
	PUBLIC_APP_DESCRIPTION: "Chat UI",
	PUBLIC_ORIGIN: "",
	PUBLIC_APP_ASSETS: "",
	PUBLIC_GOOGLE_ANALYTICS_ID: "",
	PUBLIC_PLAUSIBLE_SCRIPT_URL: "",
	PUBLIC_APPLE_APP_ID: "",
};

const dummyFeatureFlags = {
	enableAssistants: false,
	loginEnabled: false,
	isAdmin: false,
};

export const load = async ({ depends, fetch, url }) => {
	depends(UrlDependency.ConversationList);

	const client = useAPIClient({ fetch, origin: url.origin });

	// Conversations and settings are now loaded client-side from IndexedDB
	// Only load server-side data here
	// Use Promise.allSettled to handle failures gracefully
	const results = await Promise.allSettled([
		client.models.get().then(handleResponse).catch((err) => {
			if (browser) {
				console.warn("Failed to fetch models, using dummy data", err);
			}
			return dummyModels;
		}),
		client.user.get().then(handleResponse).catch((err) => {
			if (browser) {
				console.warn("Failed to fetch user, using dummy data", err);
			}
			return dummyUser;
		}),
		client["public-config"].get().then(handleResponse).catch((err) => {
			if (browser) {
				console.warn("Failed to fetch public config, using dummy data", err);
			}
			return dummyPublicConfig;
		}),
		client["feature-flags"].get().then(handleResponse).catch((err) => {
			if (browser) {
				console.warn("Failed to fetch feature flags, using dummy data", err);
			}
			return dummyFeatureFlags;
		}),
	]);

	// Extract results, using dummy data if promise was rejected
	const models =
		results[0].status === "fulfilled" ? results[0].value : dummyModels;
	const user = results[1].status === "fulfilled" ? results[1].value : dummyUser;
	const publicConfig =
		results[2].status === "fulfilled" ? results[2].value : dummyPublicConfig;
	const featureFlags =
		results[3].status === "fulfilled" ? results[3].value : dummyFeatureFlags;

	return {
		nConversations: 0,
		conversations: [],
		models,
		oldModels: [],
		user,
		settings: null, // Loaded client-side
		publicConfig: getConfigManager(publicConfig),
		...featureFlags,
	};
};
