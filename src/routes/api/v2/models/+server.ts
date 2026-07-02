import type { RequestHandler } from "@sveltejs/kit";
import { superjsonResponse } from "$lib/server/api/utils/superjsonResponse";
import type { GETModelsResponse } from "$lib/server/api/types";

// Models are loaded once at server startup; new models appear on redeploy.
// Cache for 60s so repeated invalidations (e.g. from settings saves) don't
// generate a round-trip.
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
					supportsVoice: (model as unknown as { supportsVoice?: boolean }).supportsVoice ?? false,
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
