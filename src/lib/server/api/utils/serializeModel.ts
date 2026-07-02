import type { ProcessedModel } from "$lib/server/models";
import type { GETModelResponse, GETModelsResponse } from "$lib/server/api/types";

// API responses must never serialize a model object directly: the raw
// ProcessedModel carries server-only configuration (an `endpoints` array that
// can hold per-model API keys for self-hosted deployments, prompt render
// functions, etc.). Every field that leaves the server is listed explicitly.

export function serializeModelSummary(model: ProcessedModel): GETModelsResponse[number] {
	return {
		id: model.id,
		name: model.name,
		websiteUrl: model.websiteUrl,
		modelUrl: model.modelUrl,
		datasetName: model.datasetName,
		datasetUrl: model.datasetUrl,
		displayName: model.displayName,
		description: model.description,
		logoUrl: model.logoUrl,
		promptExamples: model.promptExamples,
		preprompt: model.preprompt,
		multimodal: model.multimodal,
		multimodalAcceptedMimetypes: model.multimodalAcceptedMimetypes,
		supportsTools: (model as unknown as { supportsTools?: boolean }).supportsTools ?? false,
		supportsReasoning:
			(model as unknown as { supportsReasoning?: boolean }).supportsReasoning ?? false,
		supportsArtifacts:
			(model as unknown as { supportsArtifacts?: boolean }).supportsArtifacts ?? false,
		unlisted: model.unlisted,
		hasInferenceAPI: model.hasInferenceAPI,
		isRouter: model.isRouter,
	};
}

// Detail shape for GET /models/[namespace]([/model]): the summary plus the
// heavyweight fields (providers is ~60KB across all models) that only the
// per-model settings page needs, fetched on demand.
export function serializeModelDetail(model: ProcessedModel): GETModelResponse {
	return {
		...serializeModelSummary(model),
		providers: model.providers as unknown as Array<{ provider: string } & Record<string, unknown>>,
		parameters: model.parameters,
	};
}
