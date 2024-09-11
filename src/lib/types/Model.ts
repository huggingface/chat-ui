import type { BackendModel } from "$lib/server/models";

export type Model = Pick<
	BackendModel,
	| "id"
	| "name"
	| "displayName"
	| "websiteUrl"
	| "datasetName"
	| "promptExamples"
	| "parameters"
	| "description"
	| "logoUrl"
	| "modelUrl"
	| "tokenizer"
	| "datasetUrl"
	| "preprompt"
	| "multimodal"
	| "multimodalAcceptedMimetypes"
	| "unlisted"
	| "allowed_groups"
	| "tools"
	| "hasInferenceAPI"
>;
