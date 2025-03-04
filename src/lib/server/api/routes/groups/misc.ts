import { Elysia, env } from "elysia";
import { authPlugin } from "../../authPlugin";
import { requiresUser } from "$lib/server/auth";
import { collections } from "$lib/server/database";
import { authCondition } from "$lib/server/auth";
import { models, oldModels, type BackendModel } from "$lib/server/models";

export interface FeatureFlags {
	searchEnabled: boolean;
	enableAssistants: boolean;
	enableAssistantsRAG: boolean;
	enableCommunityTools: boolean;
	loginEnabled: boolean;
	loginRequired: boolean;
	guestMode: boolean;
}

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

export const misc = new Elysia()
	.use(authPlugin)
	.get("/feature-flags", async ({ locals }) => {
		let loginRequired = false;
		const messagesBeforeLogin = env.MESSAGES_BEFORE_LOGIN ? parseInt(env.MESSAGES_BEFORE_LOGIN) : 0;
		const nConversations = await collections.conversations.countDocuments(authCondition(locals));

		if (requiresUser && !locals.user) {
			if (messagesBeforeLogin === 0) {
				loginRequired = true;
			} else if (nConversations >= messagesBeforeLogin) {
				loginRequired = true;
			} else {
				// get the number of messages where `from === "assistant"` across all conversations.
				const totalMessages =
					(
						await collections.conversations
							.aggregate([
								{ $match: { ...authCondition(locals), "messages.from": "assistant" } },
								{ $project: { messages: 1 } },
								{ $limit: messagesBeforeLogin + 1 },
								{ $unwind: "$messages" },
								{ $match: { "messages.from": "assistant" } },
								{ $count: "messages" },
							])
							.toArray()
					)[0]?.messages ?? 0;

				loginRequired = totalMessages >= messagesBeforeLogin;
			}
		}

		return {
			searchEnabled: !!(
				env.SERPAPI_KEY ||
				env.SERPER_API_KEY ||
				env.SERPSTACK_API_KEY ||
				env.SEARCHAPI_KEY ||
				env.YDC_API_KEY ||
				env.USE_LOCAL_WEBSEARCH ||
				env.SEARXNG_QUERY_URL ||
				env.BING_SUBSCRIPTION_KEY
			),
			enableAssistants: env.ENABLE_ASSISTANTS === "true",
			enableAssistantsRAG: env.ENABLE_ASSISTANTS_RAG === "true",
			enableCommunityTools: env.COMMUNITY_TOOLS === "true",
			loginEnabled: requiresUser, // misnomer, this is actually whether the feature is available, not required
			loginRequired,
			guestMode: requiresUser && messagesBeforeLogin > 0,
		} satisfies FeatureFlags;
	})
	.get("/models", () => {
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
	.get("/models/old", () => {
		return oldModels satisfies GETOldModelsResponse;
	})
	.get("/spaces-config", () => {
		// todo: get spaces config
		return;
	});
