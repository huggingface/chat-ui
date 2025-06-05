import { Elysia } from "elysia";
import { models, oldModels, type BackendModel } from "$lib/server/models";
import { authPlugin } from "../../authPlugin";
import { authCondition } from "$lib/server/auth";
import { collections } from "$lib/server/database";

export type GETModelsResponse = Array<{
	id: string;
	name: string;
	websiteUrl?: string;
	modelUrl?: string;
	tokenizer?: string | { tokenizerUrl: string; tokenizerConfigUrl: string };
	datasetName?: string;
	datasetUrl?: string;
	displayName: string;
	description?: string;
	reasoning: boolean;
	logoUrl?: string;
	promptExamples?: { title: string; prompt: string }[];
	parameters: BackendModel["parameters"];
	preprompt?: string;
	multimodal: boolean;
	multimodalAcceptedMimetypes?: string[];
	tools: boolean;
	unlisted: boolean;
	hasInferenceAPI: boolean;
}>;

export type GETOldModelsResponse = Array<{
	id: string;
	name: string;
	displayName: string;
	transferTo?: string;
}>;

export const modelGroup = new Elysia().group("/models", (app) =>
	app
		.get("/", () => {
			return models
				.filter((m) => m.unlisted == false)
				.map((model) => ({
					id: model.id,
					name: model.name,
					websiteUrl: model.websiteUrl,
					modelUrl: model.modelUrl,
					tokenizer: model.tokenizer,
					datasetName: model.datasetName,
					datasetUrl: model.datasetUrl,
					displayName: model.displayName,
					description: model.description,
					reasoning: !!model.reasoning,
					logoUrl: model.logoUrl,
					promptExamples: model.promptExamples,
					parameters: model.parameters,
					preprompt: model.preprompt,
					multimodal: model.multimodal,
					multimodalAcceptedMimetypes: model.multimodalAcceptedMimetypes,
					tools: model.tools,
					unlisted: model.unlisted,
					hasInferenceAPI: model.hasInferenceAPI,
				})) satisfies GETModelsResponse;
		})
		.get("/old", () => {
			return oldModels satisfies GETOldModelsResponse;
		})
		.group("/:namespace/:model?", (app) =>
			app
				.derive(async ({ params, error }) => {
					let modelId: string = params.namespace;
					if (params.model) {
						modelId += "/" + params.model;
					}
					const model = models.find((m) => m.id === modelId);
					if (!model || model.unlisted) {
						return error(404, "Model not found");
					}
					return { model };
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
