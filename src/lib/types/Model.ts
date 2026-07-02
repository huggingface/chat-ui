import type { BackendModel } from "$lib/server/models";

export type Model = Pick<
	BackendModel,
	| "id"
	| "name"
	| "displayName"
	| "isRouter"
	| "websiteUrl"
	| "datasetName"
	| "description"
	| "logoUrl"
	| "modelUrl"
	| "datasetUrl"
	| "preprompt"
	| "multimodal"
	| "multimodalAcceptedMimetypes"
	| "unlisted"
	| "hasInferenceAPI"
	| "providers"
	| "supportsTools"
	| "supportsReasoning"
	| "supportsArtifacts"
>;
