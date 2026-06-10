import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import type { GETModelsResponse } from "$lib/server/api/types";

// Models are loaded at startup but can also be refreshed at runtime via
// POST /api/v2/models/refresh. Cache for 60s so repeated invalidations
// (e.g. from settings saves) don't generate a round-trip; up to 60s of
// staleness after a refresh is accepted.
const MODELS_CACHE_HEADERS = { "Cache-Control": "private, max-age=60" };

export const GET: RequestHandler = async () => {
	try {
		const { models } = await import("$lib/server/models");
		return superjsonResponse(
			models
				.filter((m) => m.unlisted == false)
				.map((model) => ({
					id: model.id,
					name: model.name,
					websiteUrl: model.websiteUrl,
					modelUrl: model.modelUrl,
					datasetName: model.datasetName,
					datasetUrl: model.datasetUrl,
					displayName: model.displayName,
					description: model.description,
					logoUrl: model.logoUrl,
					providers: model.providers as unknown as Array<
						{ provider: string } & Record<string, unknown>
					>,
					promptExamples: model.promptExamples,
					parameters: model.parameters,
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
				})) satisfies GETModelsResponse,
			{ headers: MODELS_CACHE_HEADERS }
		);
	} catch {
		return superjsonResponse([] as GETModelsResponse);
	}
};
