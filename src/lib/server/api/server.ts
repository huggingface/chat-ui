import { Elysia } from "elysia";
import { base } from "$app/paths";
import { authPlugin } from "$lib/server/api/authPlugin";
import { conversationGroup } from "$lib/server/api/routes/groups/conversations";
import { assistantGroup } from "$lib/server/api/routes/groups/assistants";
import { userGroup } from "$lib/server/api/routes/groups/user";
import { toolGroup } from "$lib/server/api/routes/groups/tools";
import { swagger } from "@elysiajs/swagger";
import { models } from "$lib/server/models";

const prefix = `${base}/api/v2` as unknown as "";

export const app = new Elysia({ prefix })
	.use(
		swagger({
			documentation: {
				info: {
					title: "Elysia Documentation",
					version: "1.0.0",
				},
			},
			provider: "swagger-ui",
		})
	)
	.use(authPlugin)
	.use(conversationGroup)
	.use(toolGroup)
	.use(assistantGroup)
	.use(userGroup)
	.get("/models", () => {
		return models
			.filter((m) => m.unlisted == false)
			.map((model) => ({
				id: model.id,
				name: model.name,
				websiteUrl: model.websiteUrl ?? "https://huggingface.co",
				modelUrl: model.modelUrl ?? "https://huggingface.co",
				tokenizer: model.tokenizer,
				datasetName: model.datasetName,
				datasetUrl: model.datasetUrl,
				displayName: model.displayName,
				description: model.description ?? "",
				logoUrl: model.logoUrl,
				promptExamples: model.promptExamples ?? [],
				preprompt: model.preprompt ?? "",
				multimodal: model.multimodal ?? false,
				unlisted: model.unlisted ?? false,
				tools: model.tools ?? false,
				hasInferenceAPI: model.hasInferenceAPI ?? false,
			}));
	})
	.get("/spaces-config", () => {
		// todo: get spaces config
		return;
	});

export type App = typeof app;
