import { Elysia, status } from "elysia";
import { refreshModels, lastModelRefreshSummary } from "$lib/server/models";
import type { BackendModel } from "$lib/server/models";
import { authPlugin } from "../../authPlugin";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";

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
	providers?: Array<{ provider: string } & Record<string, unknown>>;
	promptExamples?: { title: string; prompt: string }[];
	parameters: BackendModel["parameters"];
	preprompt?: string;
	multimodal: boolean;
	multimodalAcceptedMimetypes?: string[];
	supportsTools?: boolean;
	unlisted: boolean;
	hasInferenceAPI: boolean;
	// Mark router entry for UI decoration — always present
	isRouter: boolean;
}>;

export type GETOldModelsResponse = Array<{
	id: string;
	name: string;
	displayName: string;
	transferTo?: string;
}>;

export const modelGroup = new Elysia().group("/models", (app) =>
	app
		.get("/", async () => {
			try {
				const { models } = await import("$lib/server/models");
				return models
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
						unlisted: model.unlisted,
						hasInferenceAPI: model.hasInferenceAPI,
						isRouter: model.isRouter,
					})) satisfies GETModelsResponse;
			} catch (e) {
				// Return empty list instead of crashing the whole page
				return [] as GETModelsResponse;
			}
		})
		.get("/old", async () => {
			return [] as GETOldModelsResponse;
		})
		.group("/refresh", (app) =>
			app.use(authPlugin).post("", async ({ locals }) => {
				if (!locals.user && !locals.sessionId) {
					throw status(401, "Unauthorized");
				}
				if (!locals.isAdmin) {
					throw status(403, "Admin privileges required");
				}

				const previous = lastModelRefreshSummary;

				try {
					const summary = await refreshModels();

					return {
						refreshedAt: summary.refreshedAt.toISOString(),
						durationMs: summary.durationMs,
						added: summary.added,
						removed: summary.removed,
						changed: summary.changed,
						total: summary.total,
						hadChanges:
							summary.added.length > 0 || summary.removed.length > 0 || summary.changed.length > 0,
						previous:
							previous.refreshedAt.getTime() > 0
								? {
										refreshedAt: previous.refreshedAt.toISOString(),
										total: previous.total,
									}
								: null,
					};
				} catch (err) {
					throw status(502, "Model refresh failed");
				}
			})
		)
		.group("/:namespace/:model?", (app) =>
			app
				.derive(async ({ params, error }) => {
					let modelId: string = params.namespace;
					if (params.model) {
						modelId += "/" + params.model;
					}
					try {
						const { models } = await import("$lib/server/models");
						const model = models.find((m) => m.id === modelId);
						if (!model || model.unlisted) {
							return error(404, "Model not found");
						}
						return { model };
					} catch (e) {
						return error(500, "Models not available");
					}
				})
				.get("/", ({ model }) => {
					return model;
				})
				.use(authPlugin)
				.post("/subscribe", async ({ locals, model, error }) => {
					if (!locals.sessionId) {
						return error(401, "Unauthorized");
					}
					await collections.settings.updateOne(
						authCondition(locals),
						{
							$set: {
								activeModel: model.id,
								updatedAt: new Date(),
							},
							$setOnInsert: {
								createdAt: new Date(),
							},
						},
						{
							upsert: true,
						}
					);

					return new Response();
				})
		)
);
