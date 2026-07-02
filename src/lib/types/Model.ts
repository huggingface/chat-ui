import type { BackendModel } from "$lib/server/models";

// Client-side model shape, mirroring the models LIST payload
// (GETModelsResponse): `providers` and `parameters` are intentionally absent —
// they are heavyweight and only served by the per-model detail endpoint.
export type Model = Pick<
	BackendModel,
	| "id"
	| "name"
	| "displayName"
	| "isRouter"
	| "websiteUrl"
	| "datasetName"
	| "promptExamples"
	| "description"
	| "logoUrl"
	| "modelUrl"
	| "datasetUrl"
	| "preprompt"
	| "multimodal"
	| "multimodalAcceptedMimetypes"
	| "unlisted"
	| "hasInferenceAPI"
	| "supportsTools"
	| "supportsReasoning"
	| "supportsArtifacts"
>;
