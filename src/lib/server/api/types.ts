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
}>;

export type GETModelResponse = GETModelsResponse[number] & {
	providers?: Array<{ provider: string } & Record<string, unknown>>;
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
}
