import type { BackendModel } from "$lib/server/models";

// List shape: intentionally excludes `providers` (~60KB across all models) and
// `parameters` — no list consumer reads them, and the whole list is SSR-inlined
// into every page. They are served by the per-model detail endpoint instead.
export type GETModelsResponse = Array<{
	id: string;
	name: string;
	websiteUrl?: string;
	modelUrl?: string;
	datasetName?: string;
	datasetUrl?: string;
	displayName: string;
	description?: string;
	logoUrl?: string;
	promptExamples?: { title: string; prompt: string }[];
	preprompt?: string;
	multimodal: boolean;
	multimodalAcceptedMimetypes?: string[];
	supportsTools: boolean;
	supportsReasoning: boolean;
	supportsArtifacts: boolean;
	unlisted: boolean;
	hasInferenceAPI: boolean;
	isRouter: boolean;
	/** provider HuggingChat uses when the user has not picked one, only while the router lists it */
	defaultProvider?: string;
}>;

export type GETModelResponse = GETModelsResponse[number] & {
	// Deliberately just the provider name: the rest of the upstream router's
	// provider object is server-internal and never crosses the API boundary.
	providers?: Array<{ provider: string }>;
	parameters: BackendModel["parameters"];
};

export type GETOldModelsResponse = Array<{
	id: string;
	name: string;
	displayName: string;
	transferTo?: string;
}>;

export interface FeatureFlags {
	enableAssistants: boolean;
	loginEnabled: boolean;
	isAdmin: boolean;
	transcriptionEnabled: boolean;
	/** Fixed model used for background tasks (e.g. conversation titles); null when tasks follow the conversation's model */
	taskModelId: string | null;
	/** Models ML Intern conversations may use, in order; the first is the default. Empty when the mode is off. */
	mlAssistantModels: string[];
	/** Set when this user opted in to syncing MCP servers for personal Slack sessions. */
	slackMcpSync: { saved: boolean } | null;
}
